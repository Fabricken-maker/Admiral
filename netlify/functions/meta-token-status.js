import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  const { data } = await supabase
    .from('meta_tokens')
    .select('expires_at')
    .eq('user_id', userId)
    .single();

  if (!data) return { statusCode: 200, headers: cors, body: JSON.stringify({ connected: false }) };

  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const daysLeft = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
  const expired = daysLeft !== null && daysLeft <= 0;
  const expiringSoon = daysLeft !== null && daysLeft <= 7 && !expired;

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ connected: true, expires_at: data.expires_at, days_left: daysLeft, expired, expiring_soon: expiringSoon })
  };
};
