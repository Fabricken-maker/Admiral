/**
 * Admiral — Manuella konverteringar
 * GET  /api/conversions?budget_plan_id=X  → lista
 * POST /api/conversions                    → skapa
 * DELETE /api/conversions?id=X            → ta bort (admin)
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS');
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

  // ── GET — hämta konverteringar ────────────────────────────
  if (event.httpMethod === 'GET') {
    const bpId = event.queryStringParameters?.budget_plan_id;

    let query = supabase
      .from('manual_conversions')
      .select(`id, budget_plan_id, conversion_date, courses_sold, revenue_sek, notes, created_at,
               budget_plans(campaign_name, user_id)`)
      .order('conversion_date', { ascending: false });

    if (bpId) query = query.eq('budget_plan_id', bpId);

    // Kunder ser bara sina egna
    if (!isAdmin) {
      query = query.eq('budget_plans.user_id', userId);
    }

    const { data, error } = await query;
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };

    const totals = (data || []).reduce((acc, r) => ({
      courses_sold: acc.courses_sold + (r.courses_sold || 0),
      revenue_sek:  acc.revenue_sek  + parseFloat(r.revenue_sek || 0)
    }), { courses_sold: 0, revenue_sek: 0 });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ conversions: data, totals }) };
  }

  // ── POST — lägg till konvertering (admin) ─────────────────
  if (event.httpMethod === 'POST') {
    if (!isAdmin) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Kräver admin' }) };

    const { budget_plan_id, conversion_date, courses_sold, revenue_sek, notes } = JSON.parse(event.body || '{}');
    if (!budget_plan_id || !conversion_date) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'budget_plan_id och conversion_date krävs' }) };
    }

    const { data, error } = await supabase
      .from('manual_conversions')
      .insert({ budget_plan_id, conversion_date, courses_sold: courses_sold || 0, revenue_sek: revenue_sek || 0, notes, created_by: userId })
      .select()
      .single();

    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 201, headers: cors, body: JSON.stringify({ conversion: data }) };
  }

  // ── DELETE — ta bort (admin) ──────────────────────────────
  if (event.httpMethod === 'DELETE') {
    if (!isAdmin) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Kräver admin' }) };
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id saknas' }) };

    const { error } = await supabase.from('manual_conversions').delete().eq('id', id);
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
};
