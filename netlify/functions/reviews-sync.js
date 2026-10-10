/**
 * Admiral Modul B — daglig granskning av aktiva annonser (schema 30 5 * * * UTC).
 *
 * Gäller kunder med en varumärkesprofil. Köar bilder och videoomslag som är nya eller har ändrats
 * (samma innehåll granskas inte igen) och startar granskningskön. Läser från Meta, skriver aldrig dit.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { withTokens } from './lib/meta-graph.js';
import { collectAssets } from './lib/review-meta.js';
import { createReviewStore } from './lib/review-store.js';
import { triggerReviewRunner } from './lib/internal-auth.js';
import { redact } from './lib/review-run.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const handler = async () => {
  const store = createReviewStore(supabase);
  const { data: profiles, error } = await supabase.from('brand_profiles').select('user_id');
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const results = [];
  let queued = 0;
  for (const { user_id: userId } of profiles || []) {
    try {
      const profile = await store.getProfile(userId);
      const accounts = await store.accountsFor(userId, profile);
      const tokens = await tokensForCustomer(supabase, userId);
      if (!tokens.length) throw new Error('Ingen giltig Meta-koppling');
      let found = 0;
      let ids = [];
      for (const account of accounts) {
        const items = await withTokens(tokens, (token) => collectAssets(account, token));
        found += items.length;
        ids = ids.concat(await store.enqueue(items.map((i) => ({ ...i, user_id: userId, source: 'meta' }))));
      }
      queued += ids.length;
      results.push({ user_id: userId, found, queued: ids.length });
    } catch (e) {
      const message = redact(e.message);
      results.push({ user_id: userId, error: message });
      const { data: admin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
      if (admin) {
        await supabase.from('health_reports').insert({
          report_date: new Date().toISOString().slice(0, 10), user_id: admin.id, severity: 'warning',
          category: 'reviews_sync', message: `Granskningen av annonser misslyckades för kund ${userId}`, details: { error: message },
        });
      }
    }
  }
  // Kön körs även när inget nytt köats, så att granskningar som fastnat tas om hand.
  await triggerReviewRunner(process.env.URL || process.env.BASE_URL);
  return { statusCode: 200, body: JSON.stringify({ queued, results }) };
};

export default modern(handler);
