/**
 * Admiral — Generera inbjudningslänk
 * POST /api/invite/generate  { email? }
 * Kräver JWT-auth (admin)
 */
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function authAdmin(event) {
  const header = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = header.replace('Bearer ', '');
  if (!token) throw new Error('Ingen token');
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.email !== 'admin@admiralai.se') throw new Error('Bara admin');
  return payload;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try { authAdmin(event); }
  catch { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Åtkomst nekad' }) }; }

  // GET — lista aktiva inbjudningar
  if (event.httpMethod === 'GET') {
    const { data } = await supabase
      .from('invite_tokens')
      .select('id, token, email, created_at, expires_at, used_at, used_by_user_id')
      .order('created_at', { ascending: false })
      .limit(50);

    const now = new Date();
    const invites = (data || []).map(i => ({
      ...i,
      status: i.used_at ? 'använd'
            : new Date(i.expires_at) < now ? 'utgången'
            : 'aktiv',
      link: `${process.env.BASE_URL || 'https://admiralai.se'}/register.html?invite=${i.token}`
    }));

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ invites }) };
  }

  // POST — skapa ny inbjudning
  if (event.httpMethod === 'POST') {
    const { email } = JSON.parse(event.body || '{}');
    const token = crypto.randomBytes(24).toString('hex');

    const { data, error } = await supabase
      .from('invite_tokens')
      .insert({ token, email: email || null })
      .select('id, token, email, expires_at')
      .single();

    if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };

    const link = `${process.env.BASE_URL || 'https://admiralai.se'}/register.html?invite=${token}`;
    return { statusCode: 201, headers: CORS, body: JSON.stringify({ ...data, link }) };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
