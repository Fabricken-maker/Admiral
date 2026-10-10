/**
 * GET /api/meta/audience[?ad_account_id=] → visningar per åldersgrupp, senaste 30 dagarna.
 * Läser från Meta (endast GET). Admin: valt konto eller adminens konton. Kund: kontona i
 * kundens aktiva budgetplaner (samma regel som /api/meta/campaigns).
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { graphGet, withTokens } from './lib/meta-graph.js';
import { tokensForCustomer } from './lib/token-store.js';
import { aggregateAge } from './lib/audience.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';
const MAX_ACCOUNTS = 10;

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  let userId, isAdmin;
  try {
    const p = jwt.verify((event.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
    userId = p.id;
    isAdmin = p.email === ADMIN_EMAIL;
  } catch {
    return json(401, { error: 'Unauthorized' });
  }

  const requested = event.queryStringParameters?.ad_account_id || null;
  let accounts = [];
  const { data: plans } = await supabase.from('budget_plans').select('ad_account_id').eq('user_id', userId).eq('status', 'active');
  const own = [...new Set((plans || []).map((p) => p.ad_account_id).filter(Boolean))];
  if (requested) {
    if (!isAdmin && !own.includes(requested)) return json(403, { error: 'Åtkomst nekad' });
    accounts = [requested];
  } else {
    accounts = own;
  }

  const tokens = await tokensForCustomer(supabase, userId);
  if (!tokens.length) return json(200, { connected: false, total_impressions: 0, enough: false, groups: [] });

  try {
    const rows = await withTokens(tokens, async (token) => {
      if (!accounts.length && isAdmin) {
        const me = await graphGet('me/adaccounts', { fields: 'id', limit: MAX_ACCOUNTS }, token);
        accounts = (me.data || []).map((a) => a.id);
      }
      const out = [];
      for (const act of accounts.slice(0, MAX_ACCOUNTS)) {
        const res = await graphGet(`${act}/insights`, { fields: 'impressions,spend', breakdowns: 'age', date_preset: 'last_30d', limit: 50 }, token);
        out.push(...(res.data || []));
      }
      return out;
    });
    return json(200, { connected: true, period: 'last_30d', ...aggregateAge(rows) });
  } catch (e) {
    return json(502, { error: 'Målgruppen kunde inte hämtas från Meta.' });
  }
};

export default modern(handler);
