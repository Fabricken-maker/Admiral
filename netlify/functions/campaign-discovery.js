/**
 * Admiral — Kampanjupptäckt, körs nattligen 04:15 UTC (före recommendations-sync,
 * weekly-sync och budget-adjust så att nya planer finns när de jobben går).
 *
 * Hittar kundernas kampanjer i Meta och speglar dem i budget_plans (se lib/campaign-discovery.js).
 * Endast läsning mot Meta. Fel per kund loggas i health_reports (kategori campaign_discovery).
 *
 * Netlify blockerar HTTP-anrop till schemalagda funktioner (403 från kanten), så direktkörningen
 * efter Meta-omkoppling går via campaign-discovery-background i stället.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { runDiscovery, sanitize } from './lib/campaign-discovery.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const handler = async () => {
  try {
    const results = await runDiscovery({ supabase, tokensForCustomer, adminEmail: ADMIN_EMAIL });
    return { statusCode: 200, body: JSON.stringify({ discovered: results }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: sanitize(err.message) }) };
  }
};

export default modern(handler);
