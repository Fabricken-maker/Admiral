import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthPeriod, campaignBudget, planChanges, applyChanges, fetchAccountData, graphGetAll,
  accountsPerCustomer, backfillAdAccounts, runDiscovery, hasGoals,
} from '../netlify/functions/lib/campaign-discovery.js';

test('hasGoals: upptäckt plan utan mål → false; något mål > 0 → true', () => {
  assert.equal(hasGoals({ target_roas: null, target_cpa: null, target_revenue: null, target_courses_sold: null }), false);
  assert.equal(hasGoals({ target_roas: '0', target_revenue: 0 }), false);
  assert.equal(hasGoals({}), false);
  assert.equal(hasGoals({ target_roas: '3.5' }), true);
  assert.equal(hasGoals({ target_courses_sold: 40 }), true);
});

const TODAY = '2026-10-26'; // oktober = 31 dagar
const PERIOD = monthPeriod(TODAY);

test('monthPeriod: innevarande kalendermånad', () => {
  assert.deepEqual(PERIOD, { month_start: '2026-10-01', month_end: '2026-10-31', days: 31 });
  assert.deepEqual(monthPeriod('2026-02-03'), { month_start: '2026-02-01', month_end: '2026-02-28', days: 28 });
});

test('budget: dagsbudget på kampanjen (öre → kr × dagar i månaden)', () => {
  const b = campaignBudget({ daily_budget: '17600' }, PERIOD);
  assert.deepEqual([b.monthly, b.month_start, b.month_end, b.adsets], [5456, '2026-10-01', '2026-10-31', null]);
});

test('budget: lifetime hanteras separat med kampanjens start/slut', () => {
  const b = campaignBudget({ lifetime_budget: '1500000', start_time: '2026-09-01T08:00:00+0200', stop_time: '2026-12-15T23:59:00+0100' }, PERIOD);
  assert.deepEqual([b.monthly, b.month_start, b.month_end, b.lifetime, b.adsets], [15000, '2026-09-01', '2026-12-15', true, null]);
});

test('budget: ABO summerar aktiva ad sets, pausade räknas bara när inga är aktiva', () => {
  const adsets = [
    { id: 'a1', name: 'Ett', status: 'ACTIVE', daily_budget: '10000' },
    { id: 'a2', name: 'Två', status: 'ACTIVE', daily_budget: '5000' },
    { id: 'a3', name: 'Pausad', status: 'PAUSED', daily_budget: '99900' },
  ];
  const b = campaignBudget({ adsets }, PERIOD);
  assert.equal(b.monthly, 150 * 31);
  assert.deepEqual(b.adsets.map((a) => [a.id, a.daily_cents]), [['a1', 10000], ['a2', 5000]]);

  const paused = campaignBudget({ adsets: adsets.map((a) => ({ ...a, status: 'PAUSED' })) }, PERIOD);
  assert.deepEqual(paused.adsets.map((a) => a.id), ['a1', 'a2', 'a3']);
});

test('budget: ad set med lifetime slås ut över sin egen period', () => {
  const b = campaignBudget({ adsets: [{ id: 'a1', status: 'ACTIVE', lifetime_budget: '31000', start_time: '2026-10-01T00:00:00+0200', end_time: '2026-10-31T23:59:00+0200' }] }, PERIOD);
  assert.equal(b.adsets[0].daily_cents, 1000);
});

const plan = (extra = {}) => ({
  id: 3, campaign_id: 'c1', campaign_name: 'K1', status: 'active',
  month_start: '2026-10-01', month_end: '2026-10-31', monthly_budget: 5456, currency: 'SEK', ...extra,
});
const changesFor = (campaigns, existingPlans = []) =>
  planChanges({ userId: 6, adAccountId: 'act_1', currency: 'SEK', campaigns, existingPlans, today: TODAY });

test('ny ACTIVE kampanj utan plan → plan skapas utan mål; PAUSED utan plan skapas inte', () => {
  const ch = changesFor([
    { id: 'c1', name: 'TB', status: 'ACTIVE', daily_budget: '17600' },
    { id: 'c2', name: 'Gammal pausad', status: 'PAUSED', daily_budget: '1000' },
  ]);
  assert.equal(ch.inserts.length, 1);
  const row = ch.inserts[0].row;
  assert.deepEqual(
    [row.user_id, row.campaign_id, row.campaign_name, row.ad_account_id, row.monthly_budget, row.status, row.month_start, row.month_end],
    [6, 'c1', 'TB', 'act_1', 5456, 'active', '2026-10-01', '2026-10-31'],
  );
  assert.ok(!('target_roas' in row) && !('target_cpa' in row) && !('target_revenue' in row));
  assert.deepEqual([ch.updates, ch.completes], [[], []]);
});

test('completed-planer rörs aldrig: ny plan skapas ändå för aktiv kampanj', () => {
  const ch = changesFor(
    [{ id: 'c1', name: 'K1', status: 'ACTIVE', daily_budget: '17600' }],
    [plan({ id: 2, status: 'completed', month_end: '2026-06-18' })],
  );
  assert.equal(ch.inserts.length, 1);
  assert.deepEqual(ch.completes, []);
});

test('öppen plan synkas: ändrad dagsbudget i Meta uppdaterar planen, mål rörs inte', () => {
  const ch = changesFor([{ id: 'c1', name: 'K1', status: 'ACTIVE', daily_budget: '20000' }], [plan()]);
  assert.equal(ch.inserts.length, 0);
  assert.equal(ch.updates.length, 1);
  const patch = ch.updates[0].patch;
  assert.equal(patch.monthly_budget, 6200);
  assert.ok(!('target_roas' in patch) && !('campaign_notes' in patch) && !('total_spent' in patch));
});

test('idempotent: oförändrad kampanj ger inga ändringar alls', () => {
  const ch = changesFor([{ id: 'c1', name: 'K1', status: 'ACTIVE', daily_budget: '17600' }], [plan()]);
  assert.deepEqual([ch.inserts, ch.updates, ch.completes], [[], [], []]);
});

test('pausad i Meta → planen får status paused; aktiverad igen → active', () => {
  const paused = changesFor([{ id: 'c1', name: 'K1', status: 'PAUSED', daily_budget: '17600' }], [plan()]);
  assert.equal(paused.updates[0].patch.status, 'paused');
  const active = changesFor([{ id: 'c1', name: 'K1', status: 'ACTIVE', daily_budget: '17600' }], [plan({ status: 'paused' })]);
  assert.equal(active.updates[0].patch.status, 'active');
});

test('kampanj som försvunnit ur Meta (arkiverad) → öppen plan stängs', () => {
  const ch = changesFor([], [plan()]);
  assert.deepEqual(ch.completes, [3]);
  assert.equal(ch.inserts.length, 0);
});

test('månadsskifte: utgången plan stängs och ny skapas för innevarande månad', () => {
  const ch = changesFor(
    [{ id: 'c1', name: 'K1', status: 'ACTIVE', daily_budget: '17600' }],
    [plan({ month_start: '2026-09-01', month_end: '2026-09-30' })],
  );
  assert.deepEqual(ch.completes, [3]);
  assert.equal(ch.inserts.length, 1);
  assert.equal(ch.inserts[0].row.month_start, '2026-10-01');
});

// ── Minimal Supabase-attrapp för applyChanges/accountsPerCustomer/backfill ──
function fakeSupabase(tables = {}) {
  const writes = [];
  let nextId = 100;
  const rows = (t) => tables[t] || [];
  function from(table) {
    return {
      select() {
        const filters = [];
        const match = (r) => filters.every(([op, k, v]) =>
          op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : v.includes(r[k]));
        const q = {
          eq(k, v) { filters.push(['eq', k, v]); return q; },
          neq(k, v) { filters.push(['neq', k, v]); return q; },
          in(k, v) { filters.push(['in', k, v]); return q; },
          limit() { return q; },
          maybeSingle() { return Promise.resolve({ data: rows(table).filter(match)[0] ?? null, error: null }); },
          then(res, rej) { return Promise.resolve({ data: rows(table).filter(match), error: null }).then(res, rej); },
        };
        return q;
      },
      update(patch) {
        return {
          eq: (k, v) => { writes.push({ table, op: 'update', patch, where: { [k]: v } }); return Promise.resolve({ error: null }); },
          in: (k, v) => { writes.push({ table, op: 'update', patch, where: { [k]: v } }); return Promise.resolve({ error: null }); },
        };
      },
      insert(row) {
        writes.push({ table, op: 'insert', row });
        const id = nextId++;
        const done = Promise.resolve({ data: { id }, error: null });
        return { select: () => ({ single: () => done }), then: done.then.bind(done) };
      },
    };
  }
  return { from, writes };
}

test('applyChanges: ny plan + allokeringar skrivs; dubblettkoll hindrar andra inserten', async () => {
  const row = { user_id: 6, campaign_id: 'c1', ad_account_id: 'act_1', status: 'active' };
  const adsets = [{ id: 'a1', name: 'Ett', daily_cents: 10000 }, { id: 'a2', name: 'Två', daily_cents: 5000 }];

  const sb = fakeSupabase({ budget_plans: [] });
  await applyChanges(sb, { completes: [], updates: [], inserts: [{ row, adsets }], allocationSync: [] });
  const planInserts = sb.writes.filter((w) => w.table === 'budget_plans' && w.op === 'insert');
  const allocInserts = sb.writes.filter((w) => w.table === 'ad_set_allocations' && w.op === 'insert');
  assert.equal(planInserts.length, 1);
  assert.deepEqual(allocInserts.map((w) => [w.row.ad_set_id, w.row.daily_budget_cents, w.row.allocation_pct]), [['a1', 10000, 66.67], ['a2', 5000, 33.33]]);

  // Samma insert när en öppen plan redan finns → hoppar över (idempotens utan unikt index)
  const sb2 = fakeSupabase({ budget_plans: [{ id: 1, user_id: 6, campaign_id: 'c1', ad_account_id: 'act_1', status: 'active' }] });
  const summary = await applyChanges(sb2, { completes: [], updates: [], inserts: [{ row, adsets: null }], allocationSync: [] });
  assert.equal(summary.created, 0);
  assert.equal(sb2.writes.filter((w) => w.op === 'insert').length, 0);
});

test('applyChanges: allokeringssynk uppdaterar ändrade, lägger till nya och nollar försvunna', async () => {
  const sb = fakeSupabase({
    ad_set_allocations: [
      { id: 11, budget_plan_id: 5, ad_set_id: 'a1', ad_set_name: 'Ett', daily_budget_cents: 9000 },
      { id: 12, budget_plan_id: 5, ad_set_id: 'gammal', ad_set_name: 'Borta', daily_budget_cents: 4000 },
    ],
  });
  await applyChanges(sb, {
    completes: [], updates: [], inserts: [],
    allocationSync: [{ planId: 5, adsets: [{ id: 'a1', name: 'Ett', daily_cents: 10000 }, { id: 'a3', name: 'Ny', daily_cents: 2000 }] }],
  });
  const ups = sb.writes.filter((w) => w.table === 'ad_set_allocations' && w.op === 'update');
  const ins = sb.writes.filter((w) => w.table === 'ad_set_allocations' && w.op === 'insert');
  assert.deepEqual(ups.map((w) => [w.where.id, w.patch.daily_budget_cents]), [[11, 10000], [12, 0]]);
  assert.deepEqual(ins.map((w) => [w.row.ad_set_id, w.row.daily_budget_cents]), [['a3', 2000]]);
});

test('fetchAccountData: arkiverade filtreras, ad sets grupperas, sidor följs via cursor', async () => {
  const pages = {
    'act_1': { currency: 'SEK' },
    'act_1/campaigns': [
      { data: [{ id: 'c1', name: 'TB', status: 'ACTIVE', daily_budget: '17600' }], paging: { next: 'x', cursors: { after: 'sida2' } } },
      { data: [{ id: 'c2', name: 'Död', status: 'ARCHIVED' }, { id: 'c3', name: 'Paus', status: 'PAUSED' }] },
    ],
    'act_1/adsets': [{ data: [
      { id: 'a1', campaign_id: 'c1', status: 'ACTIVE', daily_budget: '10000' },
      { id: 'a2', campaign_id: 'c1', status: 'ARCHIVED', daily_budget: '1' },
    ] }],
  };
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.has('access_token'), true);
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, '');
    seen.push({ path, after: u.searchParams.get('after') });
    const page = pages[path];
    const body = Array.isArray(page) ? page[u.searchParams.get('after') ? 1 : 0] : page;
    return { json: async () => body };
  };
  const res = await fetchAccountData('act_1', 'tok', fetchImpl);
  assert.equal(res.currency, 'SEK');
  assert.deepEqual(res.campaigns.map((c) => [c.id, c.status, c.adsets.length]), [['c1', 'ACTIVE', 1], ['c3', 'PAUSED', 0]]);
  assert.ok(seen.some((s) => s.path === 'act_1/campaigns' && s.after === 'sida2'));
});

test('graphGetAll: slutar när paging.next saknas', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { json: async () => ({ data: [{ id: calls }], paging: { cursors: { after: 'c' } } }) }; };
  const rows = await graphGetAll('x', {}, 'tok', fetchImpl);
  assert.deepEqual([rows.length, calls], [1, 1]);
});

test('accountsPerCustomer: weekly_settings äger kontot; admins users-kopia hoppas över', async () => {
  const sb = fakeSupabase({
    users: [
      { id: 3, status: 'active', meta_ad_account_id: 'act_kund' },
      { id: 6, status: 'active', meta_ad_account_id: null },
      { id: 9, status: 'active', meta_ad_account_id: 'act_egen' },
    ],
    weekly_settings: [{ user_id: 6, ad_account_ids: ['act_kund'], active: true }],
  });
  const out = await accountsPerCustomer(sb);
  assert.deepEqual(
    out.map((c) => [c.userId, c.accounts, c.hasPrimary]),
    [[6, ['act_kund'], false], [9, ['act_egen'], true]],
  );
});

test('backfillAdAccounts: fyller från weekly_settings, skriver aldrig över, gissar aldrig bland flera', async () => {
  const sb = fakeSupabase({
    users: [{ id: 6, meta_ad_account_id: null }],
    weekly_settings: [{ user_id: 6, ad_account_ids: ['act_kund'] }],
  });
  assert.equal(await backfillAdAccounts(sb, 6), 'act_kund');
  assert.deepEqual(sb.writes[0].patch, { meta_ad_account_id: 'act_kund', meta_ad_account_id_2: null, meta_ad_account_id_3: null });

  const already = fakeSupabase({ users: [{ id: 6, meta_ad_account_id: 'act_x' }] });
  assert.equal(await backfillAdAccounts(already, 6), null);
  assert.equal(already.writes.length, 0);

  // Utan weekly_settings: me/adaccounts med exakt ETT konto används, flera lämnas
  const one = fakeSupabase({ users: [{ id: 7, meta_ad_account_id: null }], weekly_settings: [] });
  const oneAccount = async () => ({ json: async () => ({ data: [{ id: 'act_123' }] }) });
  assert.equal(await backfillAdAccounts(one, 7, 'tok', oneAccount), 'act_123');

  const many = fakeSupabase({ users: [{ id: 7, meta_ad_account_id: null }], weekly_settings: [] });
  const manyAccounts = async () => ({ json: async () => ({ data: [{ id: 'act_1' }, { id: 'act_2' }] }) });
  assert.equal(await backfillAdAccounts(many, 7, 'tok', manyAccounts), null);
  assert.equal(many.writes.length, 0);
});

// ── runDiscovery: hela körningen (delas av nattjobbet och bakgrundsfunktionen) ──
function discoveryFixtures() {
  const sb = fakeSupabase({
    users: [
      { id: 3, status: 'active', email: 'admin@admiralai.se', meta_ad_account_id: null },
      { id: 6, status: 'active', meta_ad_account_id: null },
      { id: 9, status: 'active', meta_ad_account_id: 'act_egen' },
    ],
    weekly_settings: [{ user_id: 6, ad_account_ids: ['act_kund'], active: true }],
    budget_plans: [],
  });
  const pages = {
    act_egen: { currency: 'SEK' },
    'act_egen/campaigns': { data: [{ id: 'c9', name: 'Ny', status: 'ACTIVE', daily_budget: '10000' }] },
    'act_egen/adsets': { data: [] },
  };
  const fetchImpl = async (url) => ({ json: async () => pages[new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')] || {} });
  return { sb, fetchImpl };
}

test('runDiscovery: fel hos en kund loggas i health_reports (maskerat) och stoppar inte nästa', async () => {
  const { sb, fetchImpl } = discoveryFixtures();
  const tokensForCustomer = async (_s, uid) => {
    if (uid === 6) throw new Error('Graph 190: access_token=HEMLIGT ogiltigt');
    return ['tok'];
  };
  const results = await runDiscovery({ supabase: sb, tokensForCustomer, fetchImpl });

  assert.equal(results[0].user_id, 6);
  assert.match(results[0].error, /\[REDACTED\]/);
  assert.doesNotMatch(results[0].error, /HEMLIGT/);
  assert.equal(results[1].user_id, 9);
  assert.equal(results[1].accounts[0].created, 1);

  const report = sb.writes.find((w) => w.table === 'health_reports' && w.op === 'insert');
  assert.equal(report.row.category, 'campaign_discovery');
  assert.equal(report.row.user_id, 3); // larmet går till admin
  assert.match(report.row.message, /kund 6/);
  assert.doesNotMatch(report.row.details.error, /HEMLIGT/);
});

test('runDiscovery: onlyUserId kör bara den kunden (omkopplingsfallet)', async () => {
  const { sb, fetchImpl } = discoveryFixtures();
  const asked = [];
  const tokensForCustomer = async (_s, uid) => { asked.push(uid); return ['tok']; };
  const results = await runDiscovery({ supabase: sb, tokensForCustomer, fetchImpl, onlyUserId: 9 });

  assert.deepEqual(asked, [9]);
  assert.deepEqual(results.map((r) => r.user_id), [9]);
  assert.equal(sb.writes.filter((w) => w.table === 'health_reports').length, 0);
});
