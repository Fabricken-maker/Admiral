import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWeek, weekValues, compareApiSeries } from '../src/agents/data-weekly.js';
import { expectedSyncedWeek } from '../src/agents/jobs.js';
import { evaluateWeekly } from '../src/agents/ui.js';
import { completedWeekStarts, weekFinalAfter, stockholmMidnight } from '../src/lib/time.js';
import { checkRequest } from '../src/lib/guard.js';

const tolerance = { relative: 0.01, absoluteFloor: 0.01 };
const FINAL = '2026-10-09T05:15:00Z';

// ── Tid ─────────────────────────────────────────────────────────────────────
test('veckor och 72-timmarsgräns i Stockholmstid', () => {
  assert.deepEqual(completedWeekStarts(2, new Date('2026-10-09T10:00:00Z')), ['2026-09-21', '2026-09-28']);
  assert.equal(stockholmMidnight('2026-10-26').toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(weekFinalAfter('2026-09-28').toISOString(), '2026-10-07T22:00:00.000Z');
});

test('synken förväntas ha hämtat förra veckan först 30 h efter veckoslut', () => {
  // Måndag 03:00 (hälsokollens körtid): veckan som slutade i natt är inte hämtad än.
  assert.equal(expectedSyncedWeek(new Date('2026-10-05T01:00:00Z')), '2026-09-21');
  // Tisdag 08:00: dagens synk (05:15 UTC) har hämtat den.
  assert.equal(expectedSyncedWeek(new Date('2026-10-06T06:00:00Z')), '2026-09-28');
});

// ── Lagrat mot Meta ────────────────────────────────────────────────────────
const truth = () => ({
  total: weekValues({ spend: '642.18', actions: [{ action_type: 'purchase', value: '1' }, { action_type: 'omni_purchase', value: '1' }], action_values: [{ action_type: 'omni_purchase', value: '1200' }] }),
  campaigns: new Map([['c1', { name: 'Kampanj_A', ...weekValues({ spend: '642.18', actions: [{ action_type: 'omni_purchase', value: '1' }], action_values: [{ action_type: 'omni_purchase', value: '1200' }] }) }]]),
});
const stored = (over = {}) => [
  { id: 1, campaign_id: '_konto', campaign_name: null, week_start: '2026-09-28', spend: 642.18, results: 1, revenue: 1200, is_preliminary: false, fetched_at: FINAL, ...over.total },
  { id: 2, campaign_id: 'c1', campaign_name: 'Kampanj_A', week_start: '2026-09-28', spend: 642.18, results: 1, revenue: 1200, is_preliminary: false, fetched_at: FINAL, ...over.camp },
];
const diff = (rows) => diffWeek({ customer: 'Kund A', account: 'act_1', week: '2026-09-28', rows, truth: truth(), tolerance });

test('identiska veckosiffror ger inga avvikelser (köp-typer räknas inte dubbelt)', () => {
  assert.deepEqual(diff(stored()), []);
});

test('avvikande spend, resultat och intäkt fångas med kund, vecka, kampanj och värden', () => {
  const devs = diff(stored({ total: { spend: 650 }, camp: { results: 2 } }));
  assert.equal(devs.length, 2);
  assert.deepEqual(
    devs.map((d) => [d.campaign, d.metric, d.admiral, d.source, d.week]),
    [['kontosumma', 'spend', 650, 642.18, '2026-09-28'], ['Kampanj_A (c1)', 'results', 2, 1, '2026-09-28']],
  );
  assert.equal(devs[0].row_id, 1);
});

test('spend inom ±1 % räknas som lika', () => {
  assert.deepEqual(diff(stored({ total: { spend: 646 }, camp: { spend: 638 } })), []);
});

test('kampanj som saknas i weekly_metrics men har spend hos Meta fångas', () => {
  const devs = diff(stored().filter((r) => r.campaign_id === '_konto'));
  assert.ok(devs.some((d) => d.campaign === 'Kampanj_A (c1)' && d.admiral === 'saknas' && d.row_id === null));
});

test('vecka som fortfarande är preliminär efter 72 h fångas', () => {
  const devs = diff(stored({ total: { is_preliminary: true } }));
  assert.equal(devs.length, 1);
  assert.equal(devs[0].metric, 'preliminär');
});

// ── API mot lagrat ─────────────────────────────────────────────────────────
const apiView = (over = {}) => ({
  week: { start: '2026-09-28', preliminary: false },
  series: [
    { week_start: '2026-09-21', spend: 1180.4, results: 0, revenue: 0, preliminary: false },
    { week_start: '2026-09-28', spend: 642.18, results: 1, revenue: 1200, preliminary: false },
  ],
  ...over,
});
const totals = [
  { week_start: '2026-09-21', spend: '1180.4', results: '0', revenue: '0', fetched_at: FINAL },
  { week_start: '2026-09-28', spend: '642.18', results: '1', revenue: '1200', fetched_at: FINAL },
];

test('veckovyns API stämmer med weekly_metrics', () => {
  assert.deepEqual(compareApiSeries(apiView(), totals), []);
});

test('API som visar fel siffra eller fel preliminär-märkning fångas', () => {
  const bad = apiView();
  bad.series[1] = { ...bad.series[1], spend: 700, preliminary: true };
  const p = compareApiSeries(bad, totals);
  assert.ok(p.some((x) => x.includes('spend 700')));
  assert.ok(p.some((x) => x.includes('märkt preliminär')));
  // Hämtad inom 72 h → regeln kräver preliminär
  const early = totals.map((t) => (t.week_start === '2026-09-28' ? { ...t, fetched_at: '2026-10-06T05:15:00Z' } : t));
  assert.ok(compareApiSeries(apiView(), early).some((x) => x.includes('regeln ger preliminär')));
});

// ── Skärm mot API ──────────────────────────────────────────────────────────
const where = (n) => `public/dashboard.html (${n})`;
const weekly = {
  enabled: true, status: 'ok',
  week: { start: '2026-09-28', iso_week: 40, preliminary: true },
  overall: { status: 'ok', word: 'Bättre än målet' },
  metrics: [
    { key: 'spend', label: 'Spend', value: 642.18, vs_prev: { word: 'Minskade' }, vs_avg: { word: 'Oförändrat' } },
    { key: 'cpr', label: 'Kostnad per resultat', value: 214.06, vs_prev: { word: 'Bättre' }, vs_avg: { word: 'För lite data' } },
  ],
  series: [{ spend: 1180.4, results: 0, cpr: null }, { spend: 642.18, results: 3, cpr: 214.06 }],
  chart: { metric: 'cpr', label: 'Kostnad per resultat', target: 333 },
};
const dom = (over = {}) => ({
  weekly: {
    visible: true, period: 'Vecka 40 · 28 sep – 4 okt', preliminary: true, overall: 'Bättre än målet',
    metrics: [
      { label: 'Spend', value: '642 kr', comparisons: ['↓ Minskade −43 % förra veckan', '→ Oförändrat +4 % snitt 4 v'] },
      { label: 'Kostnad per resultat', value: '214 kr', comparisons: ['↓ Bättre −20 % förra veckan', 'För lite data snitt 4 v'] },
    ],
    ...over,
  },
  charts: {
    wkVolume: { datasets: [{ data: [1180.4, 642.18] }, { data: [0, 3] }] },
    wkEfficiency: { datasets: [{ data: [null, 214.06] }, { data: [333, 333] }] },
  },
});

test('veckokortet som visar API-svaret passerar', () => {
  const [r] = evaluateWeekly({ customers: [{ user_id: 6 }] }, weekly, dom(), where);
  assert.equal(r.ok, true, r.cause);
});

test('veckokort med fel ord, saknad Preliminär eller fel diagram fångas', () => {
  const d = dom({ preliminary: false, overall: 'Sämre än målet' });
  d.charts.wkVolume.datasets[0].data = [1180.4, 700];
  const [r] = evaluateWeekly({ customers: [{ user_id: 6 }] }, weekly, d, where);
  assert.equal(r.ok, false);
  assert.match(r.cause, /Preliminär-märkningen saknas/);
  assert.match(r.cause, /helhetsomdömet "Sämre än målet"/);
  assert.match(r.cause, /spend-staplarna/);
});

test('ingen kund med veckovy (eller äldre driftsatt version) ger ingen kontroll', () => {
  assert.deepEqual(evaluateWeekly(undefined, undefined, {}, where), []);
});

// ── Skrivspärr ─────────────────────────────────────────────────────────────
test('omsynk av weekly_metrics är tillåten, radering och weekly_settings är det inte', () => {
  const opts = { supabaseUrl: 'https://x.supabase.co' };
  assert.doesNotThrow(() => checkRequest('PATCH', 'https://x.supabase.co/rest/v1/weekly_metrics?id=eq.1', opts));
  assert.doesNotThrow(() => checkRequest('POST', 'https://x.supabase.co/rest/v1/weekly_metrics', opts));
  assert.throws(() => checkRequest('DELETE', 'https://x.supabase.co/rest/v1/weekly_metrics?id=eq.1', opts));
  assert.throws(() => checkRequest('PATCH', 'https://x.supabase.co/rest/v1/weekly_settings?user_id=eq.6', opts));
  assert.throws(() => checkRequest('POST', 'https://graph.facebook.com/v25.0/act_1/insights', opts));
});
