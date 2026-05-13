/**
 * Admiral MCP — API-nyckelgenerering
 * POST /api/mcp/keys  { name, scope, user_id? }
 * Kräver JWT-auth. Admin kan skapa admin- och kundnycklar.
 * Kunder kan bara skapa egna kundnycklar.
 */
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function authUser(event) {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) throw new Error('Ingen token');
  return jwt.verify(token, process.env.JWT_SECRET);
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  let caller;
  try { caller = authUser(event); }
  catch { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Inte inloggad' }) }; }

  const isAdmin = caller.email === 'admin@admiralai.se';

  // ── GET — lista egna nycklar ──────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const query = isAdmin
      ? supabase.from('mcp_api_keys').select('id, name, key_prefix, scope, user_id, created_at, last_used_at, active').order('created_at', { ascending: false })
      : supabase.from('mcp_api_keys').select('id, name, key_prefix, scope, created_at, last_used_at, active').eq('user_id', caller.id);

    const { data, error } = await query;
    if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ keys: data }) };
  }

  // ── POST — skapa ny nyckel ────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const { name, scope, user_id } = JSON.parse(event.body || '{}');

    if (!name)  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'name krävs' }) };
    if (!scope) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'scope krävs (admin|customer)' }) };
    if (scope === 'admin' && !isAdmin) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Bara admin kan skapa admin-nycklar' }) };
    }

    // Bestäm vems nyckel det är
    const targetUserId = scope === 'admin' ? null : (isAdmin && user_id ? user_id : caller.id);

    // Generera nyckel: admiral_<scope>_<32 random bytes hex>
    const raw    = crypto.randomBytes(32).toString('hex');
    const prefix = `admiral_${scope === 'admin' ? 'adm' : 'cus'}`;
    const apiKey = `${prefix}_${raw}`;
    const hash   = crypto.createHash('sha256').update(apiKey).digest('hex');

    const { data, error } = await supabase
      .from('mcp_api_keys')
      .insert({ name, key_hash: hash, key_prefix: `${prefix}_${raw.slice(0, 8)}…`, scope, user_id: targetUserId })
      .select('id, name, key_prefix, scope, created_at')
      .single();

    if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };

    // api_key visas bara en gång — lagras aldrig i klartext
    return { statusCode: 201, headers: CORS, body: JSON.stringify({ ...data, api_key: apiKey, warning: 'Spara nyckeln nu — den visas aldrig igen.' }) };
  }

  // ── DELETE — inaktivera nyckel ────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const keyId = event.queryStringParameters?.id;
    if (!keyId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id krävs' }) };

    // Kontrollera äganderätt
    const { data: key } = await supabase.from('mcp_api_keys').select('user_id, scope').eq('id', keyId).single();
    if (!key) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Nyckel hittades inte' }) };
    if (!isAdmin && key.user_id !== caller.id) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
    }

    await supabase.from('mcp_api_keys').update({ active: false }).eq('id', keyId);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
