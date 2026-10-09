import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { modern, toLambdaEvent, toResponse } from '../netlify/functions/lib/modern.js';

test('Request blir ett Lambda-event med metod, headers i gemener, query, sökväg och body', async () => {
  const req = new Request('https://admiralai.se/api/conversions?list_plans=1&x=2', {
    method: 'POST',
    headers: { Authorization: 'Bearer abc', 'X-API-Key': 'k', 'Content-Type': 'application/json' },
    body: '{"a":1}',
  });
  const e = await toLambdaEvent(req);
  assert.equal(e.httpMethod, 'POST');
  assert.equal(e.path, '/api/conversions');
  assert.equal(e.headers.authorization, 'Bearer abc');
  assert.equal(e.headers['x-api-key'], 'k');
  assert.deepEqual(e.queryStringParameters, { list_plans: '1', x: '2' });
  assert.equal(e.body, '{"a":1}');
});

test('GET utan body ger body undefined (som Lambda-läget) och tomma query-parametrar som tomt objekt', async () => {
  const e = await toLambdaEvent(new Request('https://admiralai.se/api/user'));
  assert.equal(e.body, undefined);
  assert.deepEqual(e.queryStringParameters, {});
});

test('Lambda-svar blir Response med status, headers och body', async () => {
  const res = toResponse({ statusCode: 401, headers: { 'Content-Type': 'application/json', Vary: 'Origin' }, body: '{"error":"Unauthorized"}' });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('vary'), 'Origin');
  assert.deepEqual(await res.json(), { error: 'Unauthorized' });
});

test('omdirigering behåller Location', () => {
  const res = toResponse({ statusCode: 302, headers: { Location: '/setup-wizard.html?meta_connected=1' } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/setup-wizard.html?meta_connected=1');
});

test('204 med tom body kraschar inte (Response tillåter ingen body där)', async () => {
  const res = toResponse({ statusCode: 204, headers: {}, body: '' });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
});

test('svar utan statusCode (schemalagda jobb) blir 200, odefinierade headers hoppas över', async () => {
  const res = toResponse({ body: 'Inga aktiva planer', headers: { 'X-Tom': undefined } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.has('x-tom'), false);
  assert.equal(await res.text(), 'Inga aktiva planer');
  assert.equal(toResponse(undefined).status, 200);
});

test('modern() kör handlern med eventet och returnerar Response', async () => {
  const fn = modern(async (event) => ({ statusCode: 200, body: JSON.stringify({ m: event.httpMethod, q: event.queryStringParameters.a }) }));
  const res = await fn(new Request('https://admiralai.se/api/x?a=1'), {});
  assert.ok(res instanceof Response);
  assert.deepEqual(await res.json(), { m: 'GET', q: '1' });
});

test('alla funktioner använder modernt format (ingen Lambda-export kvar)', () => {
  const dir = new URL('../netlify/functions/', import.meta.url).pathname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/export\s+(const|async function|function)\s+handler\b/.test(src), `${f} exporterar fortfarande handler`);
    assert.match(src, /export default /, `${f} saknar default-export`);
  }
});
