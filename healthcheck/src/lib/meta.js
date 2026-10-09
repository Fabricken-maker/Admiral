// Läsklient mot Meta Marketing API. Exporterar bara läsfunktioner;
// skrivspärren i guard.js stoppar dessutom allt som inte är GET.
import { fetchJson } from './http.js';
import { redact } from './guard.js';

export function createMetaClient({ apiVersion, appId, appSecret, timeoutMs = 20_000 }) {
  const base = `https://graph.facebook.com/${apiVersion}`;

  async function get(path, params, token) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    qs.set('access_token', token);
    const url = `${base}/${path.replace(/^\//, '')}?${qs}`;
    let res = await fetchJson(url, { timeoutMs });
    if (res.status === 0 || res.status >= 500) res = await fetchJson(url, { timeoutMs }); // ett omförsök
    if (res.json?.error) {
      const e = new Error(`Meta: ${res.json.error.message}`);
      e.meta = { code: res.json.error.code, subcode: res.json.error.error_subcode };
      throw e;
    }
    if (!res.ok) throw new Error(`Meta HTTP ${res.status}: ${redact(res.error || res.text.slice(0, 200))}`);
    return res.json;
  }

  async function getAll(path, params, token, maxPages = 10) {
    const out = [];
    let after;
    for (let i = 0; i < maxPages; i++) {
      const page = await get(path, { limit: 100, ...params, ...(after ? { after } : {}) }, token);
      out.push(...(page.data || []));
      after = page.paging?.cursors?.after;
      if (!page.paging?.next || !after) break;
    }
    return out;
  }

  // Tokeninfo via app-token (app_id|app_secret).
  async function debugToken(inputToken) {
    const res = await get('debug_token', { input_token: inputToken }, `${appId}|${appSecret}`);
    return res.data || {};
  }

  // Förlänger ett giltigt långlivat användartoken (GET, ändrar inget i annonskonton).
  async function exchangeToken(token) {
    const res = await get('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: token,
    }, `${appId}|${appSecret}`);
    return res; // { access_token, token_type, expires_in? }
  }

  return { get, getAll, debugToken, exchangeToken };
}
