import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getMetaToken } from './lib/get-meta-token.js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'POST, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = event.headers.authorization || '';
  let userId;
  try {
    const decoded = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
    userId = decoded.id;
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let pixelId;
  try {
    ({ pixelId } = JSON.parse(event.body));
    pixelId = String(pixelId || '').trim();
    if (!/^\d{10,20}$/.test(pixelId)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Ogiltigt Pixel-ID — ska vara 10–20 siffror' }) };
    }
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Ogiltig förfrågan' }) };
  }

  let accessToken;
  try {
    accessToken = await getMetaToken(userId);
  } catch {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Koppla ditt Meta-konto i Steg 2 innan du verifierar pixeln', meta_not_connected: true }) };
  }

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v25.0/${pixelId}?fields=name,code_status,last_fired_time&access_token=${accessToken}`
    );
    const metaData = await metaRes.json();

    if (metaData.error) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Pixel ej hittad eller åtkomst saknas — kontrollera att pixeln tillhör ditt BM' }) };
    }

    await supabase
      .from('users')
      .update({ meta_pixel_id: pixelId })
      .eq('id', userId);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        verified: true,
        pixelId,
        pixelName: metaData.name || 'Meta Pixel',
        status: metaData.code_status || 'unknown',
        lastFired: metaData.last_fired_time || null
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
