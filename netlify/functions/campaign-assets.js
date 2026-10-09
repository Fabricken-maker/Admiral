/**
 * Admiral — Kampanj-tillgångar (kreativa)
 * GET    /api/campaign-assets?budget_plan_id=X  → lista (eller alla för admin om utan X)
 * POST   /api/campaign-assets                    → skapa
 * PUT    /api/campaign-assets?id=X               → uppdatera
 * DELETE /api/campaign-assets?id=X               → ta bort
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function ownsPlan(userId, planId) {
  const { data } = await supabase
    .from('budget_plans').select('id').eq('id', planId).eq('user_id', userId).single();
  return !!data;
}

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, POST, PUT, DELETE, OPTIONS');
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

  // ── GET ────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const planId = event.queryStringParameters?.budget_plan_id;
    let q = supabase
      .from('campaign_assets')
      .select(`id, budget_plan_id, type, url, title, description, ad_set_id, notes, active, created_at,
               budget_plans(campaign_name, user_id)`)
      .order('created_at', { ascending: false });
    if (planId) q = q.eq('budget_plan_id', planId);
    if (!isAdmin) q = q.eq('budget_plans.user_id', userId);
    const { data, error } = await q;
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ assets: data || [] }) };
  }

  // ── POST ───────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { budget_plan_id, type, url, title, description, ad_set_id, notes, active } = body;
    if (!budget_plan_id || !type || !title) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'budget_plan_id, type och title krävs' }) };
    }
    if (!['image','video','copy','link'].includes(type)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'type måste vara image/video/copy/link' }) };
    }
    if (!isAdmin && !(await ownsPlan(userId, budget_plan_id))) {
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
    }

    const { data, error } = await supabase.from('campaign_assets').insert({
      budget_plan_id, type, url, title, description, ad_set_id, notes,
      active: active !== false,
      created_by: userId
    }).select().single();
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 201, headers: cors, body: JSON.stringify({ asset: data }) };
  }

  // ── PUT ────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id krävs' }) };
    const body = JSON.parse(event.body || '{}');

    // Verifiera ägarskap
    const { data: existing } = await supabase
      .from('campaign_assets').select('budget_plan_id, budget_plans(user_id)').eq('id', id).single();
    if (!existing) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Hittades ej' }) };
    if (!isAdmin && existing.budget_plans?.user_id !== userId) {
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
    }

    const allowed = ['type','url','title','description','ad_set_id','notes','active'];
    const update = {};
    for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('campaign_assets').update(update).eq('id', id).select().single();
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ asset: data }) };
  }

  // ── DELETE ─────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id krävs' }) };

    const { data: existing } = await supabase
      .from('campaign_assets').select('budget_plan_id, budget_plans(user_id)').eq('id', id).single();
    if (!existing) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Hittades ej' }) };
    if (!isAdmin && existing.budget_plans?.user_id !== userId) {
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
    }

    const { error } = await supabase.from('campaign_assets').delete().eq('id', id);
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
};

export default modern(handler);
