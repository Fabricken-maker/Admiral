/**
 * Admiral — Black Friday-vyn (DB Golf / TeeBox)
 * GET /api/black-friday          → siffror för kampanjen (endast läsning från Meta)
 * GET /api/black-friday?demo=1   → (admin) exempeldata för att se utseendet
 *
 * Åtkomst: admin och DB Golf (user 6). Skriver aldrig till Meta.
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { BF, buildView, demoInput, fetchBlackFriday } from './lib/black-friday.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

// Köp i MATCHi, inlagda som manuella konverteringar på DB Golfs budgetplaner för BF-kampanjerna.
async function bfSales() {
  const { data, error } = await supabase
    .from('manual_conversions')
    .select('conversion_date, courses_sold, revenue_sek, notes, budget_plans!inner(campaign_name, user_id)')
    .eq('budget_plans.user_id', BF.userId)
    .in('budget_plans.campaign_name', Object.values(BF.campaignNames))
    .gte('conversion_date', BF.insightsSince);
  if (error) throw new Error(`Kunde inte läsa köpen: ${error.message}`);
  return data || [];
}

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const json = (statusCode, body) => ({ statusCode, headers: { ...cors, 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    userId = p.id;
    isAdmin = p.email === ADMIN_EMAIL;
  } catch {
    return json(401, { error: 'Unauthorized' });
  }
  if (!isAdmin && userId !== BF.userId) return json(403, { error: 'Åtkomst nekad' });

  if (event.queryStringParameters?.demo) {
    if (!isAdmin) return json(403, { error: 'Åtkomst nekad' });
    return json(200, buildView(demoInput()));
  }

  try {
    const tokens = await tokensForCustomer(supabase, BF.userId);
    if (!tokens.length) return json(403, { error: 'Inget giltigt Meta-token för DB Golf', meta_not_connected: true });
    return json(200, await fetchBlackFriday({ tokens, sales: await bfSales() }));
  } catch (err) {
    return json(502, { error: err.message });
  }
};

export default modern(handler);
