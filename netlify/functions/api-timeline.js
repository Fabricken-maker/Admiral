/**
 * Admiral — Kampanjtidslinje + kostnadskurva
 * GET /api/timeline
 * Kräver JWT-auth. Returnerar kampanjer och daglig spend.
 */
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const tokenStr = authHeader.replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const payload = jwt.verify(tokenStr, process.env.JWT_SECRET);
    userId  = payload.id;
    isAdmin = payload.email === 'admin@admiralai.se';
  } catch {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Ej inloggad' }) };
  }

  // Tidshorisont: 2 månader bakåt + 2 framåt
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
  const windowEnd   = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split('T')[0];

  // Hämta kampanjer
  let query = supabase
    .from('budget_plans')
    .select(`
      id, campaign_name, monthly_budget, total_spent,
      status, month_start, month_end,
      users(id, name, company_name, email)
    `)
    .lte('month_start', windowEnd)
    .gte('month_end',   windowStart)
    .order('month_start', { ascending: true });

  if (!isAdmin) query = query.eq('user_id', userId);

  const { data: plans, error } = await query;
  if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };

  // Hämta daglig spend (senaste 60 dagarna)
  const spendFrom = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0];
  const planIds = (plans || []).map(p => p.id);

  const { data: logs } = planIds.length ? await supabase
    .from('spend_log')
    .select('budget_plan_id, log_date, actual_spend, planned_spend')
    .in('budget_plan_id', planIds)
    .gte('log_date', spendFrom)
    .order('log_date', { ascending: true }) : { data: [] };

  // Bygg spend per dag (summerat över alla kampanjer)
  const dailyMap = {};
  for (const l of (logs || [])) {
    if (!dailyMap[l.log_date]) dailyMap[l.log_date] = { date: l.log_date, actual: 0, planned: 0 };
    dailyMap[l.log_date].actual  += parseFloat(l.actual_spend  || 0);
    dailyMap[l.log_date].planned += parseFloat(l.planned_spend || 0);
  }
  const dailySpend = Object.values(dailyMap).map(d => ({
    date:    d.date,
    actual:  Math.round(d.actual),
    planned: Math.round(d.planned)
  }));

  // Formatera kampanjer
  const campaigns = (plans || []).map(p => ({
    id:           p.id,
    name:         p.campaign_name,
    customer:     p.users?.name || p.users?.company_name || p.users?.email || '—',
    status:       p.status,
    month_start:  p.month_start,
    month_end:    p.month_end,
    monthly_budget: Math.round(p.monthly_budget || 0),
    total_spent:  Math.round(p.total_spent || 0),
    progress_pct: p.monthly_budget > 0
      ? Math.min(100, Math.round((p.total_spent / p.monthly_budget) * 100))
      : 0
  }));

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      campaigns,
      daily_spend: dailySpend,
      window: { start: windowStart, end: windowEnd },
      today: now.toISOString().split('T')[0]
    })
  };
};
