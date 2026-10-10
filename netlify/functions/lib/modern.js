/**
 * Kör en funktion skriven i Lambda-format på Netlifys moderna körmiljö.
 *
 *   Lambda-format:  handler({ httpMethod, headers, body, queryStringParameters, path })
 *                   → { statusCode, headers, body }
 *   Modernt format: export default (Request, Context) → Response
 *
 * Varför: funktioner i Lambda-kompatibilitetsläget får tillsammans högst 4 KB
 * miljövariabler (AWS Lambda). Den moderna körmiljön har ingen sådan gräns.
 * Adaptern låter varje funktion behålla sin logik oförändrad.
 *
 * Varje inloggad begäran kontrolleras också mot databasen (lib/auth-guard.js) innan funktionen
 * körs. Går databasen inte att nå stoppas begäran (503) i stället för att släppas igenom.
 */
import { authGuard } from './auth-guard.js';

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export async function toLambdaEvent(req) {
  const url = new URL(req.url);
  const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
  return {
    httpMethod: req.method,
    path: url.pathname,
    rawUrl: req.url,
    headers: Object.fromEntries(req.headers), // nycklar i gemener, som i Lambda-läget
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: text.length ? text : undefined, // som Lambda-läget: ingen body = undefined
    isBase64Encoded: false,
  };
}

export function toResponse(result) {
  if (result instanceof Response) return result;
  const r = result || {};
  const status = r.statusCode || 200;
  const headers = new Headers();
  for (const [k, v] of Object.entries(r.headers || {})) {
    if (v !== undefined && v !== null) headers.set(k, String(v));
  }
  let body = r.body ?? null;
  if (NULL_BODY_STATUS.has(status)) body = null;
  else if (body !== null && r.isBase64Encoded) body = Buffer.from(body, 'base64');
  return new Response(body, { status, headers });
}

const UNAVAILABLE = { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Tjänsten är tillfälligt otillgänglig. Försök igen.' }) };

export const modern = (handler, { guard = authGuard } = {}) => async (req, context) => {
  const event = await toLambdaEvent(req);
  let blocked = null;
  try {
    blocked = guard ? await guard(event) : null;
  } catch (e) {
    console.error('[auth-guard]', e.message);
    blocked = UNAVAILABLE;
  }
  return toResponse(blocked || await handler(event, context));
};
