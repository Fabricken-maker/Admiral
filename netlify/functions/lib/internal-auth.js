/**
 * Signerade anrop mellan Admirals egna funktioner (t.ex. när granskningskön ska köras).
 * Header x-admiral-internal: "<tid i ms>.<HMAC-SHA256(JWT_SECRET, tid)>", giltig i 5 minuter.
 */
import crypto from 'node:crypto';

export const HEADER = 'x-admiral-internal';
const MAX_AGE_MS = 5 * 60000;

const hmac = (secret, ts) => crypto.createHmac('sha256', secret).update(`admiral-internal:${ts}`).digest('hex');

export function signInternal(secret = process.env.JWT_SECRET, now = Date.now()) {
  if (!secret) throw new Error('JWT_SECRET saknas');
  return `${now}.${hmac(secret, now)}`;
}

export function verifyInternal(value, secret = process.env.JWT_SECRET, now = Date.now()) {
  if (!secret || typeof value !== 'string') return false;
  const [ts, sig] = value.split('.');
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now - t) > MAX_AGE_MS || !/^[0-9a-f]{64}$/.test(sig || '')) return false;
  const expected = Buffer.from(hmac(secret, t), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(sig, 'hex'));
}

// Startar granskningskön (bakgrundsfunktion, svarar 202 direkt).
export async function triggerReviewRunner(baseUrl, fetchImpl = fetch) {
  if (!baseUrl) return false;
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/.netlify/functions/reviews-run-background`, {
    method: 'POST',
    headers: { [HEADER]: signInternal() },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  return Boolean(res && (res.status === 202 || res.ok));
}
