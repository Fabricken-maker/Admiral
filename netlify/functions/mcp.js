/**
 * Admiral MCP Server — HTTP transport (JSON-RPC 2.0)
 * Endpoint: POST /api/mcp
 * Auth:     X-API-Key: admiral_<scope>_<random>
 *
 * Scope admin   → alla verktyg, alla kunder
 * Scope customer → egna kampanjer, spend och hälsorapporter
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { adminToolDefinitions, callAdminTool } from './lib/mcp-tools-admin.js';
import { customerToolDefinitions, callCustomerTool } from './lib/mcp-tools-customer.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

// ── Autentisering ───────────────────────────────────────────────────────────
async function authenticate(event) {
  const apiKey = event.headers['x-api-key'] || event.headers['X-API-Key'];
  if (!apiKey) throw { code: 401, message: 'X-API-Key header saknas' };

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const { data, error } = await supabase
    .from('mcp_api_keys')
    .select('id, scope, user_id, active')
    .eq('key_hash', hash)
    .single();

  if (error || !data) throw { code: 401, message: 'Ogiltig API-nyckel' };
  if (!data.active)   throw { code: 403, message: 'API-nyckeln är inaktiverad' };

  // Uppdatera last_used_at utan att blockera
  supabase.from('mcp_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {});

  return { scope: data.scope, userId: data.user_id };
}

// ── JSON-RPC svar-helpers ───────────────────────────────────────────────────
function ok(id, result) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ jsonrpc: '2.0', id, result }) };
}

function err(id, code, message) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) };
}

// ── Handler ─────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let auth;
  try {
    auth = await authenticate(event);
  } catch (e) {
    return { statusCode: e.code || 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  let req;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return err(null, -32700, 'Parse error');
  }

  const { id, method, params = {} } = req;

  try {
    // ── initialize ──────────────────────────────────────────────────────────
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: `admiral-mcp-${auth.scope}`,
          version: '1.0.0',
          description: auth.scope === 'admin'
            ? 'Admiral admin MCP — full åtkomst till alla kunder och data'
            : 'Admiral kund-MCP — åtkomst till ditt eget konto'
        }
      });
    }

    // ── notifications/initialized (no response needed) ──────────────────────
    if (method === 'notifications/initialized') {
      return { statusCode: 204, headers: CORS, body: '' };
    }

    // ── tools/list ──────────────────────────────────────────────────────────
    if (method === 'tools/list') {
      const tools = auth.scope === 'admin'
        ? adminToolDefinitions
        : customerToolDefinitions;
      return ok(id, { tools });
    }

    // ── tools/call ──────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const { name, arguments: toolArgs = {} } = params;
      if (!name) return err(id, -32602, 'Verktygsnamn saknas');

      let result;
      if (auth.scope === 'admin') {
        result = await callAdminTool(name, toolArgs);
      } else {
        result = await callCustomerTool(name, toolArgs, auth.userId);
      }

      return ok(id, {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      });
    }

    return err(id, -32601, `Okänd metod: ${method}`);

  } catch (e) {
    console.error('[mcp] Fel i verktyg:', e.message);
    return err(id, -32000, e.message || 'Internt serverfel');
  }
};
