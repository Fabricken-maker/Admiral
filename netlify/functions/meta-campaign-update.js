import jwt from 'jsonwebtoken';
import { getMetaToken } from './lib/get-meta-token.js';
import { getCorsHeaders } from './lib/cors.js';

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'POST, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  let token;
  try {
    token = await getMetaToken(userId);
  } catch (err) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: err.message, meta_not_connected: true }) };
  }

  const { campaign_id, status } = JSON.parse(event.body || '{}');
  if (!campaign_id || !['ACTIVE', 'PAUSED'].includes(status)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'campaign_id och status (ACTIVE|PAUSED) krävs' }) };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${campaign_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, access_token: token })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, campaign_id, status }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
