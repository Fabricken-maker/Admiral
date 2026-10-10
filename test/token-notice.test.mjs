import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeState, noticeRef, buildNotice, healthFinding, sendTokenNotice, swedishDate } from '../netlify/functions/lib/token-notice.js';

const NOW = new Date('2026-10-10T07:00:00Z');
const inDays = (d) => new Date(NOW.getTime() + d * 86400000).toISOString();

test('läge: mer än 7 dagar kvar ger inget mejl', () => {
  assert.equal(noticeState(inDays(30), NOW), null);
  assert.equal(noticeState(inDays(7.5), NOW), null);
});

test('läge: 7 dagar kvar, 3 dagar kvar, utgånget', () => {
  assert.equal(noticeState(inDays(7), NOW), 'sju_dagar');
  assert.equal(noticeState(inDays(4), NOW), 'sju_dagar');
  assert.equal(noticeState(inDays(3), NOW), 'tre_dagar');
  assert.equal(noticeState(inDays(0.2), NOW), 'tre_dagar');
  assert.equal(noticeState(inDays(0), NOW), 'utgatt');
  assert.equal(noticeState(inDays(-3), NOW), 'utgatt');
});

test('en koppling som gick ut för länge sedan ger inget mejl (ingen "−82 dagar")', () => {
  assert.equal(noticeState(inDays(-14), NOW), 'utgatt');
  assert.equal(noticeState(inDays(-15), NOW), null);
  assert.equal(noticeState(inDays(-82), NOW), null);
  assert.equal(noticeState(null, NOW), null);
});

test('texten har datum i svensk tid och aldrig ett negativt antal dagar', () => {
  const exp = '2026-10-12T23:30:00Z'; // 13 oktober i Stockholm
  assert.equal(swedishDate(exp), '13 oktober');
  for (const state of ['sju_dagar', 'tre_dagar', 'utgatt']) {
    const { subject, html } = buildNotice({ state, expiresAt: exp });
    assert.ok(subject.length > 0);
    assert.match(html, /13 oktober/);
    assert.match(html, /Hej,<br>/);
    assert.doesNotMatch(subject + html, /-\d+ dag|−\d+ dag|token/i);
    assert.doesNotMatch(html, /#f0c040|#1a6ae0/i); // inget guld, bara cyan som accent
  }
  assert.match(healthFinding(inDays(-82), NOW).message, /^Meta-kopplingen gick ut /);
  assert.equal(healthFinding(inDays(-82), NOW).severity, 'critical');
  assert.equal(healthFinding(inDays(5), NOW).severity, 'warning');
  assert.equal(healthFinding(inDays(30), NOW).severity, 'info');
});

test('utgångstid utan tidszon (timestamp i databasen) läses som UTC', () => {
  assert.equal(noticeRef('2026-10-13T08:00:00'), '2026-10-13T08:00:00.000Z');
  assert.equal(noticeRef('2026-10-13 08:00:00'), '2026-10-13T08:00:00.000Z');
  assert.equal(noticeRef('2026-10-13T08:00:00+00:00'), '2026-10-13T08:00:00.000Z');
  assert.equal(noticeState('2026-10-13T06:00:00', NOW), 'tre_dagar');
  assert.equal(noticeState('2026-10-13T08:00:00', NOW), 'sju_dagar'); // 3 dagar och 1 timme = 4 påbörjade dagar
});

// Minimalt Supabase för notice_log med unik nyckel (user_id, kind, ref, state).
function memorySupabase() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    from() {
      return {
        upsert(row, { ignoreDuplicates }) {
          const dup = rows.find((r) => r.user_id === row.user_id && r.kind === row.kind && r.ref === row.ref && r.state === row.state);
          let inserted = [];
          if (!dup) { const r = { id: nextId++, ...row }; rows.push(r); inserted = [r]; }
          else if (!ignoreDuplicates) inserted = [dup];
          return { select: async () => ({ data: inserted.map((r) => ({ id: r.id })), error: null }) };
        },
        delete() { return { eq: async (_c, id) => { rows.splice(rows.findIndex((r) => r.id === id), 1); return { error: null }; } }; },
        update(patch) { return { eq: async (_c, id) => { Object.assign(rows.find((r) => r.id === id), patch); return { error: null }; } }; },
      };
    },
  };
}

const USER = { id: 6, email: 'kund@example.com', company_name: 'Testbolaget' };

test('samma läge mejlas bara en gång per koppling', async () => {
  const supabase = memorySupabase();
  const sent = [];
  const sendEmail = async (m) => { sent.push(m); return { ok: true, id: `e${sent.length}` }; };
  const exp = inDays(6);

  const first = await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: NOW });
  const again = await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: new Date(NOW.getTime() + 86400000) });
  assert.equal(first.sent, true);
  assert.equal(again.sent, false);
  assert.equal(sent.length, 1);
  assert.equal(supabase.rows[0].ref, noticeRef(exp));
  assert.equal(supabase.rows[0].email_id, 'e1');

  // Nästa läge (3 dagar kvar) och sedan utgånget ger varsitt mejl
  await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: new Date(NOW.getTime() + 3.5 * 86400000) });
  await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: new Date(NOW.getTime() + 6.5 * 86400000) });
  await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: new Date(NOW.getTime() + 8 * 86400000) });
  assert.deepEqual(supabase.rows.map((r) => r.state), ['sju_dagar', 'tre_dagar', 'utgatt']);
  assert.equal(sent.length, 3);

  // Kunden kopplar om: ny utgångstid, lägena börjar om
  const renewed = inDays(5);
  const r = await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: renewed, now: NOW });
  assert.equal(r.sent, true);
  assert.equal(sent.length, 4);
});

test('misslyckat utskick försöks igen nästa körning', async () => {
  const supabase = memorySupabase();
  let fail = true;
  const sent = [];
  const sendEmail = async (m) => { if (fail) return { ok: false, error: 'nere' }; sent.push(m); return { ok: true, id: 'x' }; };
  const exp = inDays(2);
  const r1 = await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: NOW });
  assert.equal(r1.sent, false);
  assert.equal(supabase.rows.length, 0);
  fail = false;
  const r2 = await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: exp, now: NOW });
  assert.equal(r2.sent, true);
  assert.equal(sent.length, 1);
});

test('inget mejl utan e-post eller utanför lägena', async () => {
  const supabase = memorySupabase();
  const sendEmail = async () => { throw new Error('ska inte anropas'); };
  assert.equal((await sendTokenNotice({ supabase, sendEmail, user: { id: 1 }, expiresAt: inDays(2), now: NOW })).sent, false);
  assert.equal((await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: inDays(20), now: NOW })).sent, false);
  assert.equal((await sendTokenNotice({ supabase, sendEmail, user: USER, expiresAt: inDays(-82), now: NOW })).sent, false);
});
