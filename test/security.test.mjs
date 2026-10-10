import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = new URL('../netlify/functions/', import.meta.url).pathname;
const functions = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test('de gamla inloggningsfunktionerna med användare i minnet finns inte', () => {
  assert.ok(!functions.includes('auth-register.js'));
  assert.ok(!functions.includes('auth-login.js'));
});

test('ingen funktion signerar inloggningar mot användare som bara finns i minnet', () => {
  for (const f of functions) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/jwt\.sign\(/.test(src)) continue;
    assert.ok(!/const users = \{/.test(src), `${f} har en användarlista i minnet`);
    assert.match(src, /from\('users'\)|from\('invite_tokens'\)|jwt\.verify\(/, `${f} signerar utan att kontrollera användaren`);
  }
});

// ── Användarkontroll mot databasen (lib/auth-guard.js via modern.js) ───────
import jwt from 'jsonwebtoken';
import { authGuard, decision, clearAuthCache, CACHE_MS } from '../netlify/functions/lib/auth-guard.js';
import { modern } from '../netlify/functions/lib/modern.js';
import { nextState, blockedMinutes, normalizeEmail, clientIp, LIMITS } from '../netlify/functions/lib/rate-limit.js';

const SECRET = 'testhemlighet';
const bearer = (claims) => ({ headers: { authorization: `Bearer ${jwt.sign(claims, SECRET)}` } });

test('en giltig JWT räcker inte: användaren måste finnas, vara aktiv och ha samma e-post', async () => {
  const users = {
    1: { id: 1, email: 'kund@example.com', status: 'active' },
    2: { id: 2, email: 'pausad@example.com', status: 'paused' },
    3: { id: 3, email: 'slut@example.com', status: 'terminated' },
    4: { id: 4, email: 'ny@example.com', status: 'active' },
  };
  const lookup = async (id) => users[id] || null;
  clearAuthCache();
  assert.equal(await authGuard(bearer({ id: 1, email: 'kund@example.com' }), { lookup, secret: SECRET }), null);
  assert.equal((await authGuard(bearer({ id: 2, email: 'pausad@example.com' }), { lookup, secret: SECRET })).statusCode, 403);
  assert.equal((await authGuard(bearer({ id: 3, email: 'slut@example.com' }), { lookup, secret: SECRET })).statusCode, 403);
  assert.equal((await authGuard(bearer({ id: 9, email: 'borta@example.com' }), { lookup, secret: SECRET })).statusCode, 401);
  // e-posten i JWT:n stämmer inte med databasen (t.ex. en gammal admin-JWT)
  assert.equal((await authGuard(bearer({ id: 4, email: 'admin@admiralai.se' }), { lookup, secret: SECRET })).statusCode, 401);
  assert.equal(decision({ email: 'A@x.se', status: null }, { email: 'a@x.se' }), null);
});

test('begäran utan eller med ogiltig JWT släpps vidare till funktionen', async () => {
  const lookup = async () => { throw new Error('ska inte anropas'); };
  assert.equal(await authGuard({ headers: {} }, { lookup, secret: SECRET }), null);
  assert.equal(await authGuard({ headers: { authorization: 'Bearer inte-en-jwt' } }, { lookup, secret: SECRET }), null);
  assert.equal(await authGuard({ headers: { authorization: `Bearer ${jwt.sign({ id: 1 }, 'annan')}` } }, { lookup, secret: SECRET }), null);
});

test('svaret från databasen sparas i 60 sekunder', async () => {
  clearAuthCache();
  let calls = 0;
  const lookup = async () => { calls += 1; return { id: 7, email: 'k@x.se', status: 'active' }; };
  const ev = bearer({ id: 7, email: 'k@x.se' });
  await authGuard(ev, { lookup, secret: SECRET, now: 1000 });
  await authGuard(ev, { lookup, secret: SECRET, now: 1000 + CACHE_MS - 1 });
  assert.equal(calls, 1);
  await authGuard(ev, { lookup, secret: SECRET, now: 1000 + CACHE_MS + 1 });
  assert.equal(calls, 2);
});

test('modern(): stoppad begäran når aldrig funktionen, och databasfel stoppar (503) i stället för att släppa igenom', async () => {
  let ran = 0;
  const handler = async () => { ran += 1; return { statusCode: 200, body: 'ok' }; };
  const req = () => new Request('https://admiralai.se/api/x', { headers: { authorization: 'Bearer x' } });
  const blocked = await modern(handler, { guard: async () => ({ statusCode: 403, body: '{"error":"pausat"}' }) })(req(), {});
  assert.equal(blocked.status, 403);
  const down = await modern(handler, { guard: async () => { throw new Error('nere'); } })(req(), {});
  assert.equal(down.status, 503);
  assert.equal(ran, 0);
  const open = await modern(handler, { guard: async () => null })(req(), {});
  assert.equal(open.status, 200);
  assert.equal(ran, 1);
});

// ── Inloggning ────────────────────────────────────────────────────────────
test('spärren: 5 misslyckade försök per e-post och 20 per avsändare på 15 minuter', () => {
  const now = Date.parse('2026-10-10T10:00:00Z');
  let row = null;
  for (let i = 0; i < LIMITS.email; i += 1) row = { key: 'k', ...nextState(row, LIMITS.email, now + i * 1000) };
  assert.equal(row.attempts, 5);
  assert.equal(blockedMinutes(row, now + 10000), 15);
  assert.equal(blockedMinutes(row, now + 16 * 60000), 0);
  // nytt fönster efter 15 minuter
  assert.equal(nextState({ attempts: 3, window_start: new Date(now).toISOString() }, 5, now + 16 * 60000).attempts, 1);
  assert.equal(nextState(null, LIMITS.ip, now).blocked_until, null);
});

test('e-post normaliseras och avsändaren läses från Netlifys header', () => {
  assert.equal(normalizeEmail('  Kund@Example.COM '), 'kund@example.com');
  assert.equal(clientIp({ headers: { 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' } }), '203.0.113.9');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } }), '198.51.100.2');
  assert.equal(clientIp({ headers: {} }, { ip: '192.0.2.1' }), '192.0.2.1');
});

test('inloggning och registrering jämför e-post exakt, aldrig med jokertecken (ilike)', () => {
  for (const f of ['auth-login-supabase.js', 'auth-register-supabase.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\.ilike\(\s*'email'/.test(src), `${f} matchar e-post med ilike`);
    assert.match(src, /\.eq\('email', normEmail\)/, `${f} jämför inte normaliserad e-post`);
  }
  const reg = fs.readFileSync(path.join(dir, 'auth-register-supabase.js'), 'utf8');
  assert.match(reg, /invite\.email && normalizeEmail\(invite\.email\) !== normEmail/, 'registreringen kontrollerar inte inbjudans adress');
  assert.match(reg, /\.is\('used_at', null\)/, 'inbjudan tas inte atomärt');
  const user = fs.readFileSync(path.join(dir, 'api-user.js'), 'utf8');
  assert.match(user, /from\('users'\)/, '/api/user läser inte databasen');
});
