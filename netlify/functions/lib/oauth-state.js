/**
 * Signerad OAuth-state för Meta-kopplingen. Utan signatur kan vem som helst skapa en state
 * med en annan användares id och koppla sitt eget Meta-konto till den användaren.
 */
import crypto from 'node:crypto';

const MAX_AGE_MS = 10 * 60 * 1000;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload, secret) => crypto.createHmac('sha256', `meta-oauth-state:${secret}`).update(payload).digest('base64url');

export function createState(userId, secret, now = Date.now()) {
  const payload = b64url(JSON.stringify({ userId, ts: now, nonce: crypto.randomBytes(8).toString('hex') }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyState(state, secret, now = Date.now()) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) throw new Error('invalid_state');
  const expected = sign(payload, secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('invalid_state');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (!data.userId || now - data.ts > MAX_AGE_MS || data.ts > now + 60_000) throw new Error('invalid_state');
  return data;
}
