import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, fetchAccountWeeks, syncCustomer } from '../netlify/functions/lib/weekly-sync.js';
import { completedWeekStarts, TOTAL_ID } from '../netlify/functions/lib/weekly.js';

const NOW = new Date('2026-10-06T05:15:00Z'); // tisdag: veckan 28/9–4/10 är fortfarande preliminär
const WEEKS = completedWeekStarts(8, NOW);
const LAST = WEEKS.at(-1); // 2026-09-28

const insight = (week, extra = {}) => ({
  date_start: week,
  date_stop: new Date(new Date(`${week}T12:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10),
  spend: '100.50',
  impressions: '1000',
  actions: [{ action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '2' }],
  action_values: [{ action_type: 'omni_purchase', value: '900' }],
  ...extra,
});

test('rader: kontosumma alltid, kampanjer med data, försvunna kampanjer nollställs', () => {
  const rows = buildRows({
    userId: 6, adAccountId: 'act_1', weeksToWrite: [LAST], fetchedAt: NOW.toISOString(),
    insights: { account: [insight(LAST)], campaigns: [insight(LAST, { campaign_id: 'c1', campaign_name: 'Kampanj 1' })] },
    existing: [{ campaign_id: 'c2', campaign_name: 'Gammal', week_start: LAST }],
  });
  assert.deepEqual(rows.map((r) => [r.campaign_id, r.spend, r.results, r.revenue]), [
    [TOTAL_ID, 100.5, 2, 900], ['c1', 100.5, 2, 900], ['c2', 0, 0, 0],
  ]);
  assert.ok(rows.every((r) => r.is_preliminary === true && r.week_end === '2026-10-04'));
});

test('vecka utan leverans får en nollrad som kontosumma', () => {
  const rows = buildRows({ userId: 6, adAccountId: 'act_1', weeksToWrite: [WEEKS[0]], fetchedAt: NOW.toISOString(), insights: { account: [], campaigns: [] } });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].campaign_id, rows[0].spend, rows[0].is_preliminary], [TOTAL_ID, 0, false]);
});

test('perioder som inte är hela veckor mån–sön avvisas', async () => {
  const fetchImpl = async () => ({ json: async () => ({ data: [{ ...insight(LAST), date_start: '2026-09-29' }] }) });
  await assert.rejects(fetchAccountWeeks('act_1', WEEKS, 'tok', fetchImpl), /inte en hel vecka/);
});

// Minimal Supabase-attrapp: from('weekly_metrics').select().eq().gte() och upsert().
function fakeSupabase(existing) {
  const upserts = [];
  return {
    upserts,
    from() {
      const q = {
        select: () => q, eq: () => q,
        gte: async () => ({ data: existing, error: null }),
        upsert: async (rows, opts) => { upserts.push({ rows, opts }); return { error: null }; },
      };
      return q;
    },
  };
}

function fakeMeta({ invalidToken = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push({ level: u.searchParams.get('level'), token: u.searchParams.get('access_token'), range: JSON.parse(u.searchParams.get('time_range')), inc: u.searchParams.get('time_increment') });
    if (u.searchParams.get('access_token') === invalidToken) return { json: async () => ({ error: { code: 190, message: 'Invalid OAuth access token' } }) };
    const data = WEEKS.map((w) => (u.searchParams.get('level') === 'campaign' ? insight(w, { campaign_id: 'c1', campaign_name: 'K1' }) : insight(w)));
    return { json: async () => ({ data }) };
  };
  return { calls, fetchImpl };
}

test('slutliga veckor skrivs inte om, preliminära och saknade gör det', async () => {
  const existing = WEEKS.slice(0, 6).map((w) => ({ ad_account_id: 'act_1', campaign_id: TOTAL_ID, week_start: w, is_preliminary: false }))
    .concat([{ ad_account_id: 'act_1', campaign_id: TOTAL_ID, week_start: WEEKS[6], is_preliminary: true }]);
  const sb = fakeSupabase(existing);
  const meta = fakeMeta();
  const res = await syncCustomer({ supabase: sb, settings: { user_id: 6, ad_account_ids: ['act_1'] }, tokens: ['kund'], now: NOW, fetchImpl: meta.fetchImpl });
  assert.deepEqual(res.accounts[0].weeks, [WEEKS[6], WEEKS[7]]);
  const written = sb.upserts[0].rows;
  assert.deepEqual([...new Set(written.map((r) => r.week_start))], [WEEKS[6], WEEKS[7]]);
  assert.equal(sb.upserts[0].opts.onConflict, 'user_id,ad_account_id,campaign_id,week_start');
  // Veckan 21–27/9 hämtas nu (tisdag 6/10) mer än 72 h efter veckoslut → slutlig. 28/9–4/10 är preliminär.
  assert.equal(written.find((r) => r.week_start === WEEKS[6]).is_preliminary, false);
  assert.equal(written.find((r) => r.week_start === WEEKS[7]).is_preliminary, true);
  // Meta läses med hela veckor och time_increment=7
  assert.ok(meta.calls.every((c) => c.inc === '7' && c.range.since === WEEKS[0] && c.range.until === '2026-10-04'));
});

test('alla veckor slutliga: inget hämtas och inget skrivs', async () => {
  const existing = WEEKS.map((w) => ({ ad_account_id: 'act_1', campaign_id: TOTAL_ID, week_start: w, is_preliminary: false }));
  const sb = fakeSupabase(existing);
  const meta = fakeMeta();
  await syncCustomer({ supabase: sb, settings: { user_id: 6, ad_account_ids: ['act_1'] }, tokens: ['kund'], now: NOW, fetchImpl: meta.fetchImpl });
  assert.equal(meta.calls.length, 0);
  assert.equal(sb.upserts.length, 0);
});

test('ogiltigt kundtoken: Fabrickens token används i stället', async () => {
  const sb = fakeSupabase([]);
  const meta = fakeMeta({ invalidToken: 'kund' });
  const res = await syncCustomer({ supabase: sb, settings: { user_id: 6, ad_account_ids: ['act_1'] }, tokens: ['kund', 'admin'], now: NOW, fetchImpl: meta.fetchImpl });
  assert.equal(res.accounts[0].weeks.length, 8);
  assert.ok(meta.calls.some((c) => c.token === 'admin'));
});

test('andra Meta-fel avbryter synken (inget skrivs med halv data)', async () => {
  const sb = fakeSupabase([]);
  const fetchImpl = async () => ({ json: async () => ({ error: { code: 17, message: 'User request limit reached' } }) });
  await assert.rejects(syncCustomer({ supabase: sb, settings: { user_id: 6, ad_account_ids: ['act_1'] }, tokens: ['kund', 'admin'], now: NOW, fetchImpl }), /limit/);
  assert.equal(sb.upserts.length, 0);
});
