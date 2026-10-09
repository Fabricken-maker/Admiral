// Anrop mot Admirals eget API, autentiserat med kortlivade JWT som Admiral själv accepterar.
import crypto from 'node:crypto';
import { fetchJson } from './http.js';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// HS256, samma format som jsonwebtoken.sign({ id, email }, JWT_SECRET).
export function signJwt(payload, secret, ttlSec = 900) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function createAdmiral({ baseUrl, jwtSecret, timeoutMs = 20_000 }) {
  const tokenFor = (user) => signJwt({ id: user.id, email: user.email }, jwtSecret);

  async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body) h['Content-Type'] = 'application/json';
    return fetchJson(`${baseUrl}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, timeoutMs });
  }

  return { tokenFor, api, baseUrl };
}
