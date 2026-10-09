import jwt from 'jsonwebtoken';
import { getCorsHeaders } from './lib/cors.js';
import { createState } from './lib/oauth-state.js';
import { modern } from './lib/modern.js';

const handler = async (event) => {
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

  // Signerad state: kopplar token till rätt användare efter callback och går inte att förfalska
  const state = createState(userId, process.env.JWT_SECRET);

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

export default modern(handler);
