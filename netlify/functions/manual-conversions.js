/**
 * Admiral — Manuella konverteringar
 * GET  /api/conversions?budget_plan_id=X  → lista
 * POST /api/conversions                    → skapa
 * DELETE /api/conversions?id=X            → ta bort (admin)
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async (event) => {
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

  // ── GET — lista kampanjer för rollen ──────────────────────
  if (event.httpMethod === 'GET' && event.queryStringParameters?.list_plans === '1') {
    let planQ = supabase
      .from('budget_plans')
      .select('id, campaign_name, user_id, status')
      .order('id', { ascending: false });
    if (!isAdmin) planQ = planQ.eq('user_id', userId);
    const { data: plans, error: pe } = await planQ;
    if (pe) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: pe.message }) };

    // För admin: berika med kundnamn
    if (isAdmin && plans?.length) {
      const userIds = [...new Set(plans.map(p => p.user_id))];
      const { data: users } = await supabase.from('users').select('id, company_name, email').in('id', userIds);
      const uMap = Object.fromEntries((users || []).map(u => [u.id, u]));
      for (const p of plans) {
        const u = uMap[p.user_id];
        p.customer_name = u?.company_name || u?.email || `User #${p.user_id}`;
      }
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ plans: plans || [] }) };
  }

  // ── GET — hämta konverteringar ────────────────────────────
  if (event.httpMethod === 'GET') {
    const bpId = event.queryStringParameters?.budget_plan_id;
    const since = event.queryStringParameters?.since;
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'since anges som ÅÅÅÅ-MM-DD' }) };
    }

    // Kunder ser bara sina egna. "!inner" behövs: ett filter på den inbäddade budgetplanen
    // filtrerar annars bara bort planen, inte raden (och då syntes andra kunders konverteringar).
    let query = supabase
      .from('manual_conversions')
      .select(`id, budget_plan_id, conversion_date, courses_sold, revenue_sek, notes, created_at,
               budget_plans${isAdmin ? '' : '!inner'}(campaign_name, user_id)`)
      .order('conversion_date', { ascending: false });

    if (bpId) query = query.eq('budget_plan_id', bpId);
    if (since) query = query.gte('conversion_date', since);
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

  // ── POST — lägg till konvertering (admin + kund på egna planer) ──
  if (event.httpMethod === 'POST') {
    const { budget_plan_id, conversion_date, courses_sold, revenue_sek, notes } = JSON.parse(event.body || '{}');
    if (!budget_plan_id || !conversion_date) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'budget_plan_id och conversion_date krävs' }) };
    }

    // Spärra framtida datum
    const today = new Date().toISOString().slice(0, 10);
    if (conversion_date > today) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Datum får inte ligga i framtiden' }) };
    }

    // Kunder får bara skriva på egna planer
    if (!isAdmin) {
      const { data: own } = await supabase
        .from('budget_plans').select('id').eq('id', budget_plan_id).eq('user_id', userId).single();
      if (!own) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Åtkomst nekad till kampanj' }) };
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

export default modern(handler);
