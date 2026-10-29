/**
 * Admiral — Kampanjupptäckt direkt efter Meta-omkoppling (bakgrundsfunktion, svarar 202 direkt).
 *
 * Den schemalagda campaign-discovery kan inte nås via HTTP (Netlify svarar 403 från kanten),
 * så meta-oauth-callback anropar den här i stället via triggerCampaignDiscovery
 * (lib/internal-auth.js). Kräver ett signerat internt anrop; body { user_id } begränsar
 * körningen till den kund som just kopplade om.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { verifyInternal, HEADER } from './lib/internal-auth.js';
import { tokensForCustomer } from './lib/token-store.js';
import { runDiscovery, sanitize } from './lib/campaign-discovery.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const handler = async (event) => {
  if (!verifyInternal(event.headers?.[HEADER])) return { statusCode: 401, body: '' };

  let onlyUserId = null;
  try { onlyUserId = Number(JSON.parse(event.body || '{}').user_id) || null; } catch { /* alla kunder */ }

  try {
    const results = await runDiscovery({ supabase, tokensForCustomer, onlyUserId, adminEmail: ADMIN_EMAIL });
    console.log(`[campaign-discovery] klar: ${JSON.stringify(results)}`);
    return { statusCode: 200, body: JSON.stringify({ discovered: results }) };
  } catch (err) {
    console.log(`[campaign-discovery] fel: ${sanitize(err.message)}`);
    return { statusCode: 500, body: JSON.stringify({ error: sanitize(err.message) }) };
  }
};

export default modern(handler);
export const config = { background: true };
