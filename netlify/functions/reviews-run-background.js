/**
 * Admiral Modul B och E — kör granskningskön (bakgrundsfunktion, upp till 15 minuter).
 *
 * Startas av /api/reviews (ny skanning, uppladdning, granska igen), reviews-sync och fatigue-sync.
 * Kräver ett signerat internt anrop (lib/internal-auth.js). Varje granskning tas atomärt, så
 * två körningar samtidigt granskar aldrig samma bild.
 *
 * Modul E: trötta annonser utan varianter får Admirals egna varianter, som köas och granskas här.
 * En variant som blir Godkänd blir ett förslag i Modul D. Andra domslut blir aldrig förslag.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { verifyInternal, HEADER } from './lib/internal-auth.js';
import { createReviewStore, MAX_ATTEMPTS } from './lib/review-store.js';
import { runReview, redact } from './lib/review-run.js';
import { createRepo } from './lib/write-repo.js';
import { tokensForCustomer } from './lib/token-store.js';
import { ensureVariants, tryPropose } from './lib/fatigue-flow.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const MAX_RUNTIME_MS = 12 * 60000;
const MAX_VARIANT_ROUNDS = 5;

const handler = async (event) => {
  if (!verifyInternal(event.headers?.[HEADER])) return { statusCode: 401, body: '' };

  const store = createReviewStore(supabase);
  const repo = createRepo(supabase);
  const released = await store.releaseStale();
  const started = Date.now();
  const stats = { done: 0, failed: 0, proposals: 0, variants: 0 };

  for (let round = 0; round < MAX_VARIANT_ROUNDS && Date.now() - started < MAX_RUNTIME_MS; round += 1) {
    // 1. Granska allt i kön
    while (Date.now() - started < MAX_RUNTIME_MS) {
      const review = await store.claimNext();
      if (!review) break;
      try {
        const patch = await runReview(review, { store });
        await store.updateReview(review.id, patch);
        stats.done += 1;
        if (review.fatigue_id) {
          const r = await tryPropose({ supabase, repo, store, review: { ...review, ...patch }, tokens: await tokensForCustomer(supabase, review.user_id) });
          if (r.proposal) stats.proposals += 1;
        }
      } catch (e) {
        stats.failed += 1;
        const final = review.attempts >= MAX_ATTEMPTS;
        await store.updateReview(review.id, { status: final ? 'fel' : 'koar', error: redact(e.message) });
      }
    }

    // 2. Trötta annonser som saknar varianter
    const { data: waiting } = await supabase.from('ad_fatigue').select('*').eq('status', 'trott').is('variants_generated_at', null).limit(10);
    let queued = 0;
    for (const fatigue of waiting || []) {
      try {
        const r = await ensureVariants({ supabase, store, fatigue });
        queued += r.queued || 0;
      } catch (e) {
        await supabase.from('ad_fatigue').update({ status_note: `Varianter kunde inte tas fram: ${redact(e.message)}` }).eq('id', fatigue.id);
      }
    }
    stats.variants += queued;
    if (!queued) break;
  }
  console.log(`[reviews-run] klara ${stats.done}, misslyckade ${stats.failed}, varianter ${stats.variants}, förslag ${stats.proposals}, återköade ${released}`);
  return { statusCode: 200, body: JSON.stringify({ ...stats, released }) };
};

export default modern(handler);
export const config = { background: true };
