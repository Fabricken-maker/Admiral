/**
 * Admiral Modul E — daglig kontroll av kreativ trötthet (schema 45 5 * * * UTC).
 *
 * För varje kund med veckovy, varumärkesprofil eller skrivinställningar (och tröttheten påslagen):
 *  1. Mäter aktiva annonser vecka för vecka och flaggar trötta (lib/fatigue.js).
 *  2. Ser till att den trötta annonsens bild eller videoomslag är granskad (Modul B), så att
 *     varianter kan tas fram. Varianterna tas fram och granskas av granskningskön.
 *  3. Stämmer av genomförda byten och följer upp den nya annonsen mot den gamla.
 * Läser från Meta, skriver aldrig dit.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { withTokens } from './lib/meta-graph.js';
import { collectAssets } from './lib/review-meta.js';
import { createReviewStore } from './lib/review-store.js';
import { triggerReviewRunner } from './lib/internal-auth.js';
import { redact } from './lib/review-run.js';
import { detectFatigue, originalReviewFor, markSwapDone, updateFollowup, fatigueSettings } from './lib/fatigue-flow.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';
const FOLLOWUP_DAYS = 56;

async function customers() {
  const ids = new Set();
  for (const table of ['weekly_settings', 'brand_profiles', 'write_settings']) {
    const { data } = await supabase.from(table).select('user_id');
    for (const r of data || []) ids.add(r.user_id);
  }
  return [...ids];
}

const handler = async () => {
  const store = createReviewStore(supabase);
  const now = new Date();
  const results = [];

  for (const userId of await customers()) {
    try {
      if (!(await fatigueSettings(supabase, userId)).enabled) continue;
      const profile = await store.getProfile(userId);
      const accounts = await store.accountsFor(userId, profile);
      const tokens = await tokensForCustomer(supabase, userId);
      if (!accounts.length || !tokens.length) continue;

      const detected = await detectFatigue({ supabase, userId, accounts, tokens, now });

      // Trötta annonser vars bild inte är granskad: köa granskningen (Modul B).
      const { data: open } = await supabase.from('ad_fatigue').select('*').eq('user_id', userId).eq('status', 'trott').is('variants_generated_at', null);
      let queued = 0;
      const needs = [];
      for (const f of open || []) {
        const { review, pending } = await originalReviewFor(supabase, f);
        if (!review && !pending) needs.push(f);
      }
      for (const account of [...new Set(needs.map((f) => f.ad_account_id))]) {
        const adIds = new Set(needs.filter((f) => f.ad_account_id === account).map((f) => f.ad_id));
        const items = (await withTokens(tokens, (token) => collectAssets(account, token))).filter((i) => adIds.has(i.ad_id));
        queued += (await store.enqueue(items.map((i) => ({ ...i, user_id: userId, source: 'meta' })))).length;
      }

      // Genomförda byten som inte stämts av (t.ex. verifierade av proposals-maintenance).
      const { data: swapped } = await supabase.from('ad_fatigue').select('id, proposal_id, proposals!ad_fatigue_proposal_id_fkey(*)').eq('user_id', userId).eq('status', 'trott').not('proposal_id', 'is', null);
      for (const f of swapped || []) if (f.proposals) await markSwapDone(supabase, f.proposals, now);

      // Uppföljning av byten de senaste veckorna.
      const since = new Date(now.getTime() - FOLLOWUP_DAYS * 86400000).toISOString();
      const { data: replaced } = await supabase.from('ad_fatigue').select('*').eq('user_id', userId).eq('status', 'ersatt').gte('swapped_at', since);
      for (const f of replaced || []) await updateFollowup({ supabase, fatigue: f, tokens, now });

      results.push({ user_id: userId, flagged: detected.flagged?.length || 0, recovered: detected.recovered?.length || 0, assessed: detected.assessed || 0, queued });
    } catch (e) {
      const message = redact(e.message);
      results.push({ user_id: userId, error: message });
      const { data: admin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
      if (admin) {
        await supabase.from('health_reports').insert({
          report_date: now.toISOString().slice(0, 10), user_id: admin.id, severity: 'warning',
          category: 'fatigue_sync', message: `Kontrollen av kreativ trötthet misslyckades för kund ${userId}`, details: { error: message },
        });
      }
    }
  }
  // Kön tar fram och granskar varianter för trötta annonser.
  await triggerReviewRunner(process.env.URL || process.env.BASE_URL);
  return { statusCode: 200, body: JSON.stringify({ results }) };
};

export default modern(handler);
