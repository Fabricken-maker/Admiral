/**
 * Admiral — Kampanjmål
 * GET  /api/campaign-goals?budget_plan_id=X  → hämta mål + nuvarande progress
 * PUT  /api/campaign-goals                    → uppdatera mål
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, PUT, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    userId  = p.id;
    isAdmin = p.email === 'admin@admiralai.se';
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── GET ──────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const bpId = event.queryStringParameters?.budget_plan_id;
    let q = supabase
      .from('budget_plans')
      .select('id, campaign_name, user_id, monthly_budget, total_spent, month_start, month_end, target_courses_sold, target_revenue, target_roas, target_cpa, campaign_notes')
      .order('id', { ascending: false });
    if (bpId) q = q.eq('id', bpId);
    if (!isAdmin) q = q.eq('user_id', userId);
    const { data: plans, error } = await q;
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };

    // Berika varje plan med faktiska siffror (sålda kurser + intäkt)
    const enriched = await Promise.all((plans || []).map(async (p) => {
      const { data: conv } = await supabase
        .from('manual_conversions')
        .select('courses_sold, revenue_sek')
        .eq('budget_plan_id', p.id);

      const courses = (conv || []).reduce((s, c) => s + parseInt(c.courses_sold || 0), 0);
      const revenue = (conv || []).reduce((s, c) => s + parseFloat(c.revenue_sek || 0), 0);
      const spend   = parseFloat(p.total_spent || 0);
      const roas    = spend > 0 ? revenue / spend : 0;
      const cpa     = courses > 0 ? spend / courses : 0;

      return {
        ...p,
        progress: { courses, revenue, spend, roas, cpa }
      };
    }));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ plans: enriched }) };
  }

  // ── PUT ──────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body || '{}');
    const { budget_plan_id, target_courses_sold, target_revenue, target_roas, target_cpa, campaign_notes } = body;
    if (!budget_plan_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'budget_plan_id krävs' }) };

    // Verifiera att kunden äger planen (admin har alltid access)
    if (!isAdmin) {
      const { data: own } = await supabase
        .from('budget_plans').select('id').eq('id', budget_plan_id).eq('user_id', userId).single();
      if (!own) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
    }

    const update = {};
    if (target_courses_sold !== undefined) update.target_courses_sold = target_courses_sold;
    if (target_revenue      !== undefined) update.target_revenue      = target_revenue;
    if (target_roas         !== undefined) update.target_roas         = target_roas;
    if (target_cpa          !== undefined) update.target_cpa          = target_cpa;
    if (campaign_notes      !== undefined) update.campaign_notes      = campaign_notes;
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('budget_plans').update(update).eq('id', budget_plan_id).select().single();
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ plan: data }) };
  }

  return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
};
