import jwt from 'jsonwebtoken';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'POST, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  // Modul D: Admiral ändrar aldrig något i Meta utan ett registrerat godkännande för just den
  // åtgärden. Direkt paus/start av kampanjer är därför avstängt; ändringar går via /api/proposals.
  void userId;
  return {
    statusCode: 403,
    headers: cors,
    body: JSON.stringify({ error: 'Ändringar i Meta görs via förslag som godkänns. Direkt paus/start av kampanjer är avstängt.' })
  };
};

export default modern(handler);
