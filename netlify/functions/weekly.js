/**
 * Admiral Modul C — Veckoutveckling
 * GET /api/weekly                    → senast avslutade vecka, alla kampanjer
 * GET /api/weekly?campaign_id=X      → samma för en kampanj
 * GET /api/weekly?user_id=Y          → (admin) en kunds vecka
 * GET /api/weekly?customers=1        → (admin) kunder som har veckovy
 *
 * Endast läsning. Siffrorna kommer från weekly_metrics (synkade från Meta av weekly-sync).
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { buildWeeklyView, listCampaigns, completedWeekStarts } from './lib/weekly.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    userId = p.id;
    isAdmin = p.email === ADMIN_EMAIL;
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const q = event.queryStringParameters || {};
  const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

  if (q.customers) {
    if (!isAdmin) return json(403, { error: 'Åtkomst nekad' });
    const { data, error } = await supabase
      .from('weekly_settings')
      .select('user_id, users!inner(email, company_name)')
      .eq('active', true)
      .order('user_id');
    if (error) return json(500, { error: error.message });
    return json(200, { customers: data.map((c) => ({ user_id: c.user_id, name: c.users.company_name ? `${c.users.company_name} · ${c.users.email}` : c.users.email })) });
  }

  let customerId = userId;
  if (q.user_id) {
    if (!isAdmin) return json(403, { error: 'Åtkomst nekad' });
    customerId = parseInt(q.user_id, 10);
    if (!Number.isInteger(customerId)) return json(400, { error: 'Ogiltigt user_id' });
  }

  const { data: settings, error: sErr } = await supabase
    .from('weekly_settings')
    .select('*')
    .eq('user_id', customerId)
    .eq('active', true)
    .maybeSingle();
  if (sErr) return json(500, { error: sErr.message });
  if (!settings) return json(200, { enabled: false });

  // Lite marginal bakåt så att vyn fungerar även om synken släpar några dygn.
  const since = completedWeekStarts(12)[0];
  const { data: rows, error: rErr } = await supabase
    .from('weekly_metrics')
    .select('ad_account_id, campaign_id, campaign_name, week_start, spend, results, revenue, impressions, fetched_at, is_preliminary')
    .eq('user_id', customerId)
    .in('ad_account_id', settings.ad_account_ids || [])
    .gte('week_start', since)
    .order('week_start');
  if (rErr) return json(500, { error: rErr.message });

  const campaigns = listCampaigns(rows);
  const campaignId = q.campaign_id || null;
  if (campaignId && !rows.some((r) => r.campaign_id === campaignId)) return json(404, { error: 'Kampanjen finns inte i veckovyn' });

  const view = buildWeeklyView(rows, settings, { campaignId });
  const campaign = campaignId ? { id: campaignId, name: rows.find((r) => r.campaign_id === campaignId)?.campaign_name || campaignId } : null;
  return json(200, { enabled: true, user_id: customerId, campaign, campaigns, ...view });
};

export default modern(handler);
