// Definition of done: agenterna körs parallellt och inom tidsgränsen;
// en agent som kraschar eller hänger tystnar inte utan blir RÖD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../src/config.js';
import { runHealthcheck, AGENTS } from '../src/orchestrator.js';

const config = buildConfig({
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'k', JWT_SECRET: 's',
  META_APP_ID: '1', META_APP_SECRET: 's', HC_AGENT_TIMEOUT_MS: '400', HC_VERIFIER_TIMEOUT_MS: '400',
});
const real = { ...AGENTS };

// Supabase-stubb: veckans schemalagda körning finns redan.
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return new Response(JSON.stringify([{ id: 1, status: 'GRÖN' }]), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('idempotent: en andra schemalagd körning samma vecka gör ingenting', async () => {
  let ran = false;
  for (const k of Object.keys(AGENTS)) AGENTS[k] = { run: async () => { ran = true; return []; } };
  const res = await runHealthcheck(config, { trigger: 'scheduled', noNotify: true });
  assert.equal(res.skipped, true);
  assert.match(res.runKey, /^weekly-\d{4}-W\d{2}$/);
  assert.equal(ran, false);
  assert.ok(calls.every((u) => u.includes('/rest/v1/admiral_healthchecks?select=')), 'bara en läsning, inga skrivningar');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = () => runHealthcheck(config, { trigger: 'test', noPersist: true, noNotify: true });

test.afterEach(() => Object.assign(AGENTS, real));

test('fyra agenter körs parallellt', async () => {
  for (const k of Object.keys(AGENTS)) AGENTS[k] = { run: async () => { await sleep(250); return [{ id: `${k}.x`, ok: true }]; } };
  const t = Date.now();
  const res = await run();
  assert.ok(Date.now() - t < 450, `tog ${Date.now() - t} ms — agenterna körs inte parallellt`);
  assert.equal(res.status, 'GRÖN');
  assert.equal(res.row.checks_total, 4);
});

test('agent som hänger stoppas av sin tidsgräns och ger RÖD', async () => {
  for (const k of Object.keys(AGENTS)) AGENTS[k] = { run: async () => [{ id: `${k}.x`, ok: true }] };
  AGENTS.ui = { run: () => sleep(5000).then(() => []) };
  const t = Date.now();
  const res = await run();
  assert.ok(Date.now() - t < 1000);
  assert.equal(res.status, 'RÖD');
  assert.match(res.report, /Agenten ui kraschade: agent ui: tidsgräns/);
});

test('agent som kraschar ger RÖD', async () => {
  for (const k of Object.keys(AGENTS)) AGENTS[k] = { run: async () => [{ id: `${k}.x`, ok: true }] };
  AGENTS.data = { run: async () => { throw new Error('boom'); } };
  const res = await run();
  assert.equal(res.status, 'RÖD');
  assert.match(res.report, /Agenten data kraschade: boom/);
});

test('reparerat och verifierat fel ger GUL; verifieraren kör om kontrollen', async () => {
  let fixed = false;
  for (const k of Object.keys(AGENTS)) AGENTS[k] = { run: async () => [{ id: `${k}.x`, ok: true }] };
  AGENTS.infra = { run: async () => { fixed = true; return [{ id: 'infra.t', ok: false, human: false, cause: 'Token går ut', action: { ok: true, description: 'Förnyade token' }, recheck: async () => ({ ok: fixed }) }]; } };
  const res = await run();
  assert.equal(res.status, 'GUL');
  assert.match(res.report, /Verifierad: felet är borta ✓/);
});

test('reparation som inte håller vid verifiering ger RÖD', async () => {
  for (const k of Object.keys(AGENTS)) AGENTS[k] = { run: async () => [{ id: `${k}.x`, ok: true }] };
  AGENTS.data = { run: async () => [{ id: 'data.t', ok: false, human: false, cause: 'Avvikelse', action: { ok: true, description: 'Omsynk' }, recheck: async () => ({ ok: false, cause: 'kvar' }) }] };
  const res = await run();
  assert.equal(res.status, 'RÖD');
  assert.match(res.report, /Verifierad: NEJ — kvar/);
});
