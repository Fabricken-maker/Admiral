import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplayed, evaluate, expectedSpendWindow, isAppRequest } from '../src/agents/ui.js';

test('bara Admirals egna anrop bedöms; Netlifys injicerade skript ignoreras', () => {
  const base = 'https://admiralai.se';
  assert.equal(isAppRequest('https://admiralai.se/api/meta/campaigns', base), true);
  assert.equal(isAppRequest('https://admiralai.se/auth/login', base), true);
  assert.equal(isAppRequest('https://admiralai.se/dashboard.html', base), true);
  assert.equal(isAppRequest('https://admiralai.se/icons/icon-192.png', base), true);
  assert.equal(isAppRequest('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js', base), true);
  assert.equal(isAppRequest('https://admiralai.se/_F7m2AQxGlTJlHiC1OASE_eZxctlQqj2BRaCOIt', base), false);
  assert.equal(isAppRequest('https://www.google-analytics.com/g/collect?v=2', base), false);
});

test('tolkar dashboardens talformat', () => {
  assert.deepEqual(parseDisplayed('3 474 kr'), { value: 3474, precision: 0.5 });
  assert.deepEqual(parseDisplayed('67K'), { value: 67000, precision: 500 });
  assert.equal(parseDisplayed('1.2M').value, 1_200_000);
  assert.deepEqual(parseDisplayed('4.73×'), { value: 4.73, precision: 0.005 });
  assert.equal(parseDisplayed('—').value, null);
});

const where = (needle) => `public/dashboard.html (${needle})`;
function snap(overrides = {}) {
  return {
    consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], blockedWrites: [],
    api: {
      '/api/meta/accounts': { accounts: [{ spend: 1234.56, impressions: 45678, clicks: 1500, conversions: 0 }] },
      '/api/meta/campaigns': { campaigns: [{ name: 'Kampanj A', spend: 987.65 }] },
      '/api/conversions': { totals: { revenue_sek: 10000 } },
      '/api/timeline': { campaigns: [], daily_spend: [] },
      '/api/reports': { reports: [{ id: 1 }] },
    },
    dom: {
      url: '/dashboard.html',
      kpi: { spend: '1 235 kr', impressions: '46K', clicks: '2K', conversions: '—', roas: '8.10×' },
      campaigns: [{ name: 'Kampanj A', spend: '988 kr' }],
      charts: { spendChart: null, bokaChart: null, audChart: null },
      timelinePlaceholder: true,
    },
    search: [],
    notifs: { placeholder: false, count: 1 },
    ...overrides,
  };
}
const failures = (s) => evaluate(s, where).filter((r) => !r.ok);

test('korrekt renderad dashboard ger inga fel', () => {
  assert.deepEqual(failures(snap()).map((f) => f.id), []);
});

test('KPI som avviker från källdatan fångas', () => {
  const s = snap();
  s.dom.kpi.spend = '1 400 kr';
  const f = failures(s);
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'ui.kpi spend');
});

test('tomt KPI-värde trots data fångas', () => {
  const s = snap();
  s.dom.kpi.impressions = '—';
  assert.match(failures(s)[0].cause, /visar "—" trots att källdatan är 45678/);
});

test('hårdkodade diagram och platshållardata där riktig data finns fångas', () => {
  const s = snap({
    search: [{ label: 'Sommarkampanjen 2026', type: 'Kampanj' }],
    notifs: { placeholder: true, count: 5 },
  });
  s.dom.charts.audChart = { labels: ['Ålder'], datasets: [{ data: [40, 30, 20, 10] }] };
  const ids = failures(s).map((f) => f.id).sort();
  assert.deepEqual(ids, ['ui.diagram målgrupp', 'ui.notiser platshållare', 'ui.sök platshållare']);
});

test('tidslinjens exempeldata är ok när det inte finns riktiga kampanjer, fel annars', () => {
  const s = snap();
  s.api['/api/timeline'] = { campaigns: [{ month_start: '2026-10-01' }], daily_spend: [] };
  assert.ok(failures(s).some((f) => f.id === 'ui.tidslinje platshållare'));
});

test('spenddiagrammet jämförs datapunkt för datapunkt mot /api/timeline', () => {
  const now = new Date('2026-10-09T08:00:00Z');
  const timeline = { campaigns: [{ month_start: '2026-10-01' }], daily_spend: [{ date: '2026-09-30', actual: 5 }, { date: '2026-10-01', actual: 100 }, { date: '2026-10-02', actual: 120 }] };
  assert.deepEqual(expectedSpendWindow(timeline, now).map((d) => d.date), ['2026-10-01', '2026-10-02']);
});

test('konsolfel, trasiga laddningar och skrivförsök fångas', () => {
  const ids = failures(snap({ consoleErrors: ['TypeError: x is undefined'], badResponses: ['500 admiralai.se/api/timeline'], blockedWrites: ['POST /api/meta/campaign/update'] }))
    .map((f) => f.id).sort();
  assert.deepEqual(ids, ['ui.konsol', 'ui.laddning', 'ui.skrivning-vid-laddning']);
});

import { evaluateAudience } from '../src/agents/ui.js';

test('målgruppsdiagrammet måste visa exakt /api/meta/audience', () => {
  const audience = { enough: true, groups: [{ age: '25-34', share: 0.6123 }, { age: '35-44', share: 0.3877 }] };
  const chart = (labels, data) => ({ labels, datasets: [{ data }] });
  assert.equal(evaluateAudience(chart(['25-34', '35-44'], [61.2, 38.8]), audience).ok, true);
  assert.equal(evaluateAudience(chart(['Ålder', 'Kön', 'Intressen', 'Geografi'], [40, 30, 20, 10]), audience).ok, false);
  assert.equal(evaluateAudience(chart(['25-34'], [100]), null).ok, false, 'diagram utan data från API:t');
  assert.equal(evaluateAudience(null, { enough: false, groups: [] }).ok, true, 'inget diagram vid för lite data');
});
