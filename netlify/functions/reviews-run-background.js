/**
 * Admiral Modul B — kör granskningskön (bakgrundsfunktion, upp till 15 minuter).
 *
 * Startas av /api/reviews (ny skanning, uppladdning, granska igen) och av reviews-sync.
 * Kräver ett signerat internt anrop (lib/internal-auth.js). Varje granskning tas atomärt, så
 * två körningar samtidigt granskar aldrig samma bild.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { verifyInternal, HEADER } from './lib/internal-auth.js';
import { createReviewStore, MAX_ATTEMPTS } from './lib/review-store.js';
import { runReview, redact } from './lib/review-run.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const MAX_RUNTIME_MS = 12 * 60000;

const handler = async (event) => {
  if (!verifyInternal(event.headers?.[HEADER])) return { statusCode: 401, body: '' };

  const store = createReviewStore(supabase);
  const released = await store.releaseStale();
  const started = Date.now();
  let done = 0;
  let failed = 0;
  while (Date.now() - started < MAX_RUNTIME_MS) {
    const review = await store.claimNext();
    if (!review) break;
    try {
      await store.updateReview(review.id, await runReview(review, { store }));
      done += 1;
    } catch (e) {
      failed += 1;
      const final = review.attempts >= MAX_ATTEMPTS;
      await store.updateReview(review.id, { status: final ? 'fel' : 'koar', error: redact(e.message) });
    }
  }
  console.log(`[reviews-run] klara ${done}, misslyckade ${failed}, återköade ${released}`);
  return { statusCode: 200, body: JSON.stringify({ done, failed, released }) };
};

export default modern(handler);
export const config = { background: true };
