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
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .single();

  if (!data) return { statusCode: 200, headers: cors, body: JSON.stringify({ connected: false }) };

  // Kolla expiry-datum i DB
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const daysLeft = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
  const expiredByDate = daysLeft !== null && daysLeft <= 0;

  // Verifiera tokenet live mot Meta (lightweight /me-anrop)
  let metaValid = true;
  if (data.access_token && !expiredByDate) {
    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(data.access_token)}`
      );
      const metaJson = await metaRes.json();
      if (metaJson.error) metaValid = false;
    } catch {
      metaValid = false;
    }
  }

  const expired = expiredByDate || !metaValid;
  const expiringSoon = !expired && daysLeft !== null && daysLeft <= 7;

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      connected: true,
      expires_at: data.expires_at,
      days_left: daysLeft,
      expired,
      expiring_soon: expiringSoon,
      meta_valid: metaValid
    })
  };
};
