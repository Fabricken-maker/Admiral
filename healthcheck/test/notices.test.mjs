import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentNotice, missingNotices } from '../src/agents/jobs-notices.js';

const NOW = new Date('2026-10-12T09:00:00Z');
const tok = (user_id, expires_at) => ({ user_id, expires_at, users: { email: `u${user_id}@example.com`, company_name: null } });

test('nuvarande läge och när det började', () => {
  assert.equal(currentNotice('2026-10-30T00:00:00', NOW), null);
  assert.equal(currentNotice('2026-10-17T00:00:00', NOW).state, 'sju_dagar');
  assert.equal(currentNotice('2026-10-13T00:00:00', NOW).state, 'tre_dagar');
  assert.equal(currentNotice('2026-10-11T00:00:00', NOW).state, 'utgatt');
  assert.equal(currentNotice('2026-07-19T00:00:00', NOW), null); // gick ut för länge sedan
});

test('saknat mejl larmar först när nattjobbet har hunnit köra', () => {
  // tre_dagar började 2026-10-10 00:00 → mer än 26 h sedan
  const tokens = [tok(3, '2026-10-13T00:00:00'), tok(6, '2026-07-19T00:00:00')];
  assert.deepEqual(missingNotices(tokens, [], NOW).map((m) => [m.user_id, m.state]), [[3, 'tre_dagar']]);
  const log = [{ user_id: 3, ref: '2026-10-13T00:00:00.000Z', state: 'tre_dagar' }];
  assert.equal(missingNotices(tokens, log, NOW).length, 0);
  // Läget började för mindre än 26 h sedan → inget larm än
  assert.equal(missingNotices([tok(3, '2026-10-15T00:00:00')], [], NOW).length, 0);
});

test('mejl för en tidigare koppling räknas inte', () => {
  const log = [{ user_id: 3, ref: '2026-08-01T00:00:00.000Z', state: 'tre_dagar' }];
  assert.equal(missingNotices([tok(3, '2026-10-13T00:00:00')], log, NOW).length, 1);
});
