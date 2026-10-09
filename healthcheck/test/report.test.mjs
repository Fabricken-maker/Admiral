// Definition of done: rapporten innehåller noll utvecklingsförslag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, decideStatus, FORBIDDEN_WORDS, STATUS } from '../src/report.js';

const base = { startedAt: new Date('2026-10-12T05:00:00Z'), weekKey: '2026-W42', trigger: 'scheduled', dryRun: false };

const repaired = {
  agent: 'infra', id: 'infra.meta-token user 3', cause: 'Meta-token för admin@admiralai.se går ut 2026-10-13 (om 3 dagar)',
  where: 'meta_tokens user_id 3', human: false, verified: true,
  action: { kind: 'token-renewal', description: 'Förnyade Meta-token för admin@admiralai.se', ok: true, before: { expires_at: '2026-10-13' }, after: { expires_at: '2026-12-11' } },
};
const human = {
  agent: 'infra', id: 'infra.supabase rate_limits', cause: 'Tabellen rate_limits saknas i databasen',
  where: 'netlify/functions/auth-login-supabase.js (inloggningsspärr)', human: true, verified: false,
};
const dataIssue = {
  agent: 'data', id: 'data.admin.kampanj.spend', cause: 'Spend på kampanjnivå avviker från Meta för 1 kampanj(er) (admin-vyn)',
  where: 'netlify/functions/meta-campaigns.js', human: true, verified: false,
  deviations: [{ customer: 'admin', campaign: 'X (1)', metric: 'spend', admiral: 1037.03, source: 987.65, diff: 49.38 }],
};

test('status: GRÖN utan avvikelser, GUL när allt reparerats och verifierats, RÖD annars', () => {
  assert.equal(decideStatus([]), STATUS.GREEN);
  assert.equal(decideStatus([repaired]), STATUS.YELLOW);
  assert.equal(decideStatus([repaired, human]), STATUS.RED);
  assert.equal(decideStatus([{ ...repaired, verified: false }]), STATUS.RED);
});

test('första raden är statusraden', () => {
  const r = buildReport({ ...base, status: STATUS.RED, totals: { checks: 40, ok: 37, skipped: 0 }, issues: [repaired, human, dataIssue] });
  assert.match(r.split('\n')[0], /^🔴 RÖD — Admiral veckokontroll 2026-W42/);
  assert.match(r.split('\n')[1], /^40 kontroller, 37 ok, 1 reparerade, 2 kräver människa\.$/);
});

test('GRÖN-rapport är bara summering', () => {
  const r = buildReport({ ...base, status: STATUS.GREEN, totals: { checks: 40, ok: 40, skipped: 0 }, issues: [] });
  assert.equal(r.split('\n').length, 2);
});

test('avvikelse loggas med kund, kampanj, mått, Admiral-värde, källvärde och differens', () => {
  const r = buildReport({ ...base, status: STATUS.RED, totals: { checks: 1, ok: 0, skipped: 0 }, issues: [dataIssue] });
  assert.match(r, /admin \/ X \(1\): spend Admiral 1037\.03, Meta 987\.65, diff \+49\.38/);
});

test('rapporten innehåller noll utvecklingsförslag', () => {
  const r = buildReport({
    ...base, status: STATUS.RED,
    totals: { checks: 40, ok: 36, skipped: 1, skippedList: [{ agent: 'ui', cause: 'Ingen webbläsare konfigurerad (BROWSER_WS_ENDPOINT eller CHROME_PATH)' }] },
    issues: [repaired, human, dataIssue, { ...repaired, verified: false, verifyCause: 'felet kvarstår' }],
  }).toLowerCase();
  for (const w of FORBIDDEN_WORDS) assert.ok(!r.includes(w), `rapporten innehåller "${w}"`);
});

test('ingen fasttext i agenterna innehåller förslagsord', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = new URL('../src/agents/', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    // Bara strängar som kan hamna i rapporten (inom backticks eller citattecken).
    const strings = (src.match(/`[^`]*`|'[^'\n]*'/g) || []).join('\n').toLowerCase();
    for (const w of FORBIDDEN_WORDS) assert.ok(!strings.includes(w), `${path.basename(f)} innehåller "${w}"`);
  }
});
