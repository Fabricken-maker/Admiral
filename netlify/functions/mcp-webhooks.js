/**
 * Admiral MCP — Webhook-hantering
 * GET    /api/mcp/webhooks         — lista webhooks
 * POST   /api/mcp/webhooks         — registrera ny webhook
 * DELETE /api/mcp/webhooks?id=     — ta bort webhook
 * POST   /api/mcp/webhooks/test?id= — skicka testping
 *
 * Auth: X-API-Key (admin-scope krävs)
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { fireWebhook } from './lib/fire-webhooks.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

const VALID_EVENTS = [
  'account.inactive',
  'token.expiring',
  'token.expired',
  'budget.deviation',
  'account.status_changed'
];

async function authenticate(event) {
  const apiKey = event.headers['x-api-key'] || event.headers['X-API-Key'];
  if (!apiKey) throw new Error('X-API-Key saknas');
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const { data } = await supabase
    .from('mcp_api_keys')
    .select('scope, active')
    .eq('key_hash', hash)
    .single();
  if (!data || !data.active) throw new Error('Ogiltig nyckel');
  if (data.scope !== 'admin') throw new Error('Admin-nyckel krävs');
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try { await authenticate(event); }
  catch (e) { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) }; }

  const path = event.path || '';
  const isTest = path.endsWith('/test');

  // ── GET — lista webhooks ──────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data } = await supabase
      .from('webhook_subscriptions')
      .select('id, name, url, events, active, created_at, last_fired_at, last_status')
      .order('created_at', { ascending: false });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ webhooks: data || [], valid_events: VALID_EVENTS }) };
  }

  // ── POST /test — testping ─────────────────────────────────────────────────
  if (event.httpMethod === 'POST' && isTest) {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id krävs' }) };
    await fireWebhook('test.ping', { message: 'Admiral webhook-test', timestamp: new Date().toISOString() });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  // ── POST — skapa webhook ──────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const { name, url, events = [], secret } = JSON.parse(event.body || '{}');
    if (!name) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'name krävs' }) };
    if (!url)  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'url krävs' }) };
    if (!events.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Minst ett event krävs' }) };

    const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
    if (invalidEvents.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Ogiltiga events: ${invalidEvents.join(', ')}` }) };

    // Generera secret om ingen anges
    const webhookSecret = secret || crypto.randomBytes(24).toString('hex');

    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .insert({ name, url, secret: webhookSecret, events })
      .select('id, name, url, events, created_at')
      .single();

    if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };

    return {
      statusCode: 201,
      headers: CORS,
      body: JSON.stringify({
        ...data,
        secret: webhookSecret,
        warning: 'Spara secret — används för att verifiera X-Admiral-Signature. Visas bara en gång.'
      })
    };
  }

  // ── DELETE — ta bort webhook ──────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id krävs' }) };
    await supabase.from('webhook_subscriptions').delete().eq('id', id);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
