import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekKey, stockholmDate, addDays, monthStart } from '../src/lib/time.js';
import { expectedRunDays } from '../src/agents/jobs.js';

test('veckonyckel i svensk tid', () => {
  assert.equal(isoWeekKey(new Date('2026-10-12T05:00:00Z')), '2026-W42');
  assert.equal(isoWeekKey(new Date('2026-10-11T22:30:00Z')), '2026-W42'); // måndag 00:30 svensk tid
  assert.equal(isoWeekKey(new Date('2027-01-01T12:00:00Z')), '2026-W53');
});

test('datumhjälpare', () => {
  assert.equal(stockholmDate(new Date('2026-10-08T22:30:00Z')), '2026-10-09');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(monthStart('2026-06-17'), '2026-06-01');
});

test('förväntade körningsdygn för dagliga jobb', () => {
  const before = expectedRunDays(7, 3, new Date('2026-10-09T07:10:00Z'));
  assert.deepEqual(before, ['2026-10-06', '2026-10-07', '2026-10-08']);
  const after = expectedRunDays(7, 3, new Date('2026-10-09T08:00:00Z'));
  assert.deepEqual(after, ['2026-10-07', '2026-10-08', '2026-10-09']);
});
