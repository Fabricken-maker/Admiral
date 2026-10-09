// Definition of done: inga skrivanrop mot Meta kan göras av modulen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRequest, installGuard, WriteBlockedError } from '../src/lib/guard.js';
import { createMetaClient } from '../src/lib/meta.js';

const opts = { baseUrl: 'https://admiralai.se', supabaseUrl: 'https://exempel.supabase.co' };
const blocked = (m, u) => assert.throws(() => checkRequest(m, u, opts), WriteBlockedError, `${m} ${u} ska spärras`);
const allowed = (m, u) => assert.doesNotThrow(() => checkRequest(m, u, opts), `${m} ${u} ska tillåtas`);

test('Meta: alla skrivmetoder spärras', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    blocked(m, 'https://graph.facebook.com/v25.0/120000000000000001');
    blocked(m, 'https://graph.facebook.com/v25.0/act_1/campaigns');
    blocked(m, 'https://graph-video.facebook.com/v25.0/act_1/advideos');
  }
});

test('Meta: method-override och batch via GET spärras', () => {
  blocked('GET', 'https://graph.facebook.com/v25.0/120000000000000001?method=post&daily_budget=100');
  blocked('GET', 'https://graph.facebook.com/v25.0/120000000000000001?METHOD=DELETE');
  blocked('GET', 'https://graph.facebook.com/v25.0/?batch=[{"method":"POST"}]');
});

test('Meta: läsning tillåts', () => {
  allowed('GET', 'https://graph.facebook.com/v25.0/act_1/insights?fields=spend');
  allowed('GET', 'https://graph.facebook.com/v25.0/debug_token?input_token=x');
});

test('Admiral: bara läsning, utom inloggningsproben', () => {
  blocked('POST', 'https://admiralai.se/api/meta/campaign/update');
  blocked('POST', 'https://admiralai.se/api/budget/activate');
  blocked('POST', 'https://admiralai.se/.netlify/functions/budget-adjust');
  blocked('DELETE', 'https://admiralai.se/api/conversions?id=1');
  blocked('PUT', 'https://admiralai.se/api/campaign-goals');
  allowed('POST', 'https://admiralai.se/auth/login');
  allowed('GET', 'https://admiralai.se/api/meta/campaigns');
});

test('Supabase: aldrig radering, schema eller RPC; skrivning bara till tillåtna tabeller', () => {
  const sb = opts.supabaseUrl;
  blocked('DELETE', `${sb}/rest/v1/spend_log?id=eq.1`);
  blocked('DELETE', `${sb}/rest/v1/admiral_healthchecks?id=eq.1`);
  blocked('POST', `${sb}/rest/v1/rpc/exec_sql`);
  blocked('POST', `${sb}/pg/query`);
  blocked('PATCH', `${sb}/rest/v1/users?id=eq.3`);
  blocked('POST', `${sb}/rest/v1/spend_log`);
  blocked('PATCH', `${sb}/rest/v1/budget_plans?id=eq.1`.replace('budget_plans', 'ad_set_allocations'));
  blocked('POST', `${sb}/auth/v1/admin/users`);
  allowed('PATCH', `${sb}/rest/v1/spend_log?id=eq.1`);
  allowed('PATCH', `${sb}/rest/v1/meta_tokens?id=eq.1`);
  allowed('POST', `${sb}/rest/v1/admiral_healthchecks`);
});

test('Okända värdar: bara läsning; Telegram bara sendMessage', () => {
  blocked('POST', 'https://api.netlify.com/api/v1/sites/x/builds');
  blocked('PATCH', 'https://api.netlify.com/api/v1/accounts/x/env/RESEND_API_KEY');
  allowed('GET', 'https://api.netlify.com/api/v1/sites/x');
  allowed('POST', 'https://api.telegram.org/bot123:abc/sendMessage');
  blocked('POST', 'https://api.telegram.org/bot123:abc/deleteMessage');
});

test('Installerad spärr stoppar skrivning mot Meta innan nätverket nås', async () => {
  installGuard(opts);
  let reachedNetwork = false;
  const started = Date.now();
  await assert.rejects(
    fetch('https://graph.facebook.com/v25.0/120000000000000001', { method: 'POST', body: 'daily_budget=1' })
      .then(() => { reachedNetwork = true; }),
    WriteBlockedError,
  );
  assert.equal(reachedNetwork, false);
  assert.ok(Date.now() - started < 50, 'ska kasta synkront, utan nätverksanrop');
});

test('Metaklienten har inga skrivfunktioner', () => {
  const client = createMetaClient({ apiVersion: 'v25.0', appId: '1', appSecret: 's' });
  assert.deepEqual(Object.keys(client).sort(), ['debugToken', 'exchangeToken', 'get', 'getAll']);
});

test('Ingen kod utanför metaklienten anropar Meta direkt', () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const files = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.js'));
  const offenders = files.filter((f) => {
    if (f === path.join('lib', 'meta.js') || f === path.join('lib', 'guard.js')) return false;
    return /graph\.facebook\.com/.test(fs.readFileSync(path.join(src, f), 'utf8'));
  });
  assert.deepEqual(offenders, []);
});
