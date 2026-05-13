import jwt from 'jsonwebtoken';
import { getCorsHeaders } from './lib/cors.js';

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Encode userId in state so we can link the token after callback
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64');

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${process.env.BASE_URL}/api/meta/oauth/callback`,
    scope: 'ads_management,ads_read,business_management',
    response_type: 'code',
    state
  });

  const url = `https://www.facebook.com/dialog/oauth?${params}`;
  return { statusCode: 200, headers: cors, body: JSON.stringify({ url }) };
};
