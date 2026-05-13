/**
 * Admiral Admin — Alla kampanjer
 * GET /api/admin/campaigns
 * Kräver JWT admin-auth
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
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.email !== 'admin@admiralai.se') throw new Error('Åtkomst nekad');
  } catch {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: plans, error } = await supabase
    .from('budget_plans')
    .select(`
      id, campaign_name, campaign_id, monthly_budget, total_spent,
      status, month_start, month_end, updated_at,
      users(id, email, name, company_name, status),
      ad_set_allocations(ad_set_id, daily_budget_cents, last_roas, allocation_pct)
    `)
    .order('status', { ascending: true })
    .order('monthly_budget', { ascending: false });

  if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };

  // Hämta senaste pacing från spend_log per plan
  const planIds = (plans || []).map(p => p.id);
  const { data: logs } = await supabase
    .from('spend_log')
    .select('budget_plan_id, pacing_ratio, actual_spend, log_date')
    .in('budget_plan_id', planIds)
    .eq('log_date', today);

  const pacingMap = {};
  for (const l of (logs || [])) pacingMap[l.budget_plan_id] = l.pacing_ratio;

  const campaigns = (plans || []).map(p => {
    const now = new Date();
    const monthEnd = new Date(p.month_end);
    const monthStart = new Date(p.month_start);
    const daysLeft = Math.max(0, Math.ceil((monthEnd - now) / 86400000));
    const daysTotal = Math.ceil((monthEnd - monthStart) / 86400000);
    const daysElapsed = daysTotal - daysLeft;
    const plannedSpend = daysTotal > 0 ? (p.monthly_budget / daysTotal) * daysElapsed : 0;
    const pacing = pacingMap[p.id] ?? (plannedSpend > 0 ? (p.total_spent || 0) / plannedSpend : null);

    const avgRoas = p.ad_set_allocations?.length
      ? p.ad_set_allocations.reduce((s, a) => s + (a.last_roas || 0), 0) / p.ad_set_allocations.length
      : null;

    const spent = p.total_spent || 0;
    const budget = p.monthly_budget || 0;

    return {
      id: p.id,
      campaign_name: p.campaign_name,
      campaign_id: p.campaign_id,
      status: p.status,
      customer_id:   p.users?.id,
      customer_name: p.users?.name || p.users?.company_name || p.users?.email || '—',
      customer_email: p.users?.email,
      customer_status: p.users?.status,
      monthly_budget: Math.round(budget),
      spent: Math.round(spent),
      remaining: Math.round(budget - spent),
      pacing_ratio: pacing !== null ? parseFloat(pacing.toFixed(3)) : null,
      pacing_pct: pacing !== null ? Math.round(pacing * 100) : null,
      avg_roas: avgRoas !== null ? parseFloat(avgRoas.toFixed(2)) : null,
      ad_sets: p.ad_set_allocations?.length || 0,
      days_left: daysLeft,
      month_start: p.month_start,
      month_end: p.month_end,
      updated_at: p.updated_at
    };
  });

  // Summor
  const active = campaigns.filter(c => c.status === 'active');
  const summary = {
    total: campaigns.length,
    active: active.length,
    total_budget: Math.round(active.reduce((s, c) => s + c.monthly_budget, 0)),
    total_spent:  Math.round(active.reduce((s, c) => s + c.spent, 0)),
    avg_pacing:   active.filter(c => c.pacing_ratio !== null).length
      ? Math.round(active.filter(c => c.pacing_ratio !== null)
          .reduce((s, c) => s + c.pacing_ratio, 0) / active.filter(c => c.pacing_ratio !== null).length * 100)
      : null
  };

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ campaigns, summary })
  };
};
