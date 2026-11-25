import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BF, buildView, demoInput, filmFor, isBfAd, fetchBlackFriday, windowState } from '../netlify/functions/lib/black-friday.js';

test('filmer känns igen på annonsnamnet', () => {
  assert.equal(filmFor('TB_BF_Pris_1x1'), 'pris');
  assert.equal(filmFor('BF_Spara780_Varm'), 'spara780');
  assert.equal(filmFor('BF_Ganget'), 'ganget');
  assert.equal(filmFor('Något annat'), null);
});

test('Black Friday-annons: bara namn med BF/Black Friday, inte Prova50 eller andra nya annonser', () => {
  assert.ok(isBfAd({ name: 'TB_BF_6tim1500_Pris' }));
  assert.ok(isBfAd({ name: 'TB_BF_Ganget_Varm' }));
  assert.ok(isBfAd({ name: 'Black Friday 2026' }));
  assert.ok(!isBfAd({ name: 'TB_Kall_Video1', created_time: '2026-10-01T10:00:00+0200' }));
  assert.ok(!isBfAd({ name: 'TB_ProvaPa50_Ganget', created_time: '2026-11-23T14:00:00+0100' }));
  assert.ok(!isBfAd({ name: 'Ny annons', created_time: '2026-11-24T14:00:00+0100' }));
  assert.ok(!isBfAd({ name: 'Bfoo' }));
});

test('Prova50 räknas inte, och leverans före 25 nov redovisas separat', () => {
  const input = demoInput();
  const base = input.rows.reduce((s, r) => s + Number(r.spend), 0);
  input.ads.push({ id: 'p50', name: 'TB_ProvaPa50_Ganget', campaign_id: 'c1', created_time: '2026-11-23T10:00:00+0100' });
  input.rows.push({ ad_id: 'p50', campaign_id: 'c1', date_start: '2026-11-25', spend: '44', impressions: '600', clicks: '7' });
  input.rows.push({ ad_id: 'a1', campaign_id: 'c1', date_start: '2026-11-24', spend: '12.5', impressions: '200', clicks: '3' });
  const v = buildView(input);
  assert.equal(v.totals.spend, base);
  assert.equal(v.budget.pre_start_spend, 12.5);
  assert.ok(!v.ads.some((a) => a.name.includes('Prova')));
  assert.equal(v.films.find((f) => f.key === 'ganget').ads, 1);
  assert.ok(!v.days.some((d) => d.date < '2026-11-25'));
  assert.ok(v.notes.some((n) => n.includes('12,50 kr')));
});

test('tidsgränsen: före, under och efter erbjudandet', () => {
  assert.equal(windowState(new Date('2026-11-24T12:00:00+01:00')).state, 'before');
  const live = windowState(new Date('2026-11-26T12:00:00+01:00'));
  assert.equal(live.state, 'live');
  assert.equal(live.seconds_left, Math.round((new Date(BF.endsAt) - new Date('2026-11-26T12:00:00+01:00')) / 1000));
  assert.equal(windowState(new Date('2026-11-28T00:00:00+01:00')).state, 'ended');
  assert.equal(new Date(BF.endsAt).getTime(), new Date('2026-11-27T22:59:59Z').getTime());
});

test('budgeten: 2 000 kr, plan 200+750+950, reserv 100', () => {
  const v = buildView({ now: new Date('2026-11-24T12:00:00+01:00') });
  assert.equal(v.budget.total, 2000);
  assert.equal(v.budget.planned, 1900);
  assert.equal(v.budget.reserve, 100);
  assert.deepEqual(v.days.map((d) => [d.date, d.planned]), [['2026-11-25', 200], ['2026-11-26', 750], ['2026-11-27', 950]]);
  assert.ok(v.notes.length >= 1);
});

test('siffror: spend, klick, kostnad per klick, köp (max av typerna) och per annons', () => {
  const v = buildView(demoInput());
  assert.equal(v.demo, true);
  assert.equal(v.ads.length, 5);
  const spend = 62 + 58 + 40 + 24 + 18 + 262 + 231 + 170 + 51 + 36;
  assert.equal(v.totals.spend, spend);
  assert.equal(v.totals.results, 1 + 1 + 2 + 2);
  assert.ok(Math.abs(v.totals.cost_per_result - spend / 6) < 1e-9);
  assert.equal(v.budget.left, 2000 - spend);
  const day26 = v.days.find((d) => d.date === '2026-11-26');
  assert.equal(day26.spend, 750);
  assert.equal(day26.vs_plan, 0);
  assert.ok(day26.cpc > 0);
  const pris = v.films.find((f) => f.key === 'pris');
  assert.equal(pris.ads, 2);
  assert.equal(pris.spend, 62 + 262 + 24 + 51);
  assert.equal(v.campaigns.length, 2);
  assert.equal(v.campaigns.find((c) => c.role === 'warm').name, 'TB_Varm_2026H2');
});

test('köptyperna summeras inte', () => {
  const input = demoInput();
  input.rows = [{ ad_id: 'a1', campaign_id: 'c1', date_start: '2026-11-26', spend: '100', impressions: '1000', clicks: '10',
    actions: [{ action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '2' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }] }];
  assert.equal(buildView(input).totals.results, 2);
});

test('rader från icke-BF-annonser räknas inte', () => {
  const input = demoInput();
  input.ads.push({ id: 'old', name: 'TB_Kall_Gammal', campaign_id: 'c1', created_time: '2026-09-01T10:00:00+0200' });
  input.rows.push({ ad_id: 'old', campaign_id: 'c1', date_start: '2026-11-26', spend: '999', impressions: '1', clicks: '1' });
  assert.equal(buildView(input).totals.spend, demoInput().rows.reduce((s, r) => s + Number(r.spend), 0));
});

test('hämtningen använder bara GET mot Meta och skickar aldrig något', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    const u = String(url);
    const data = u.includes('/campaigns') ? [{ id: 'c1', name: 'TB_Trafik_2026H2' }, { id: 'x', name: 'Annan' }] : [];
    return { json: async () => ({ data }) };
  };
  const v = await fetchBlackFriday({ tokens: [{ token: 't' }], now: new Date('2026-11-24T12:00:00+01:00'), fetchImpl });
  assert.equal(v.campaigns.length, 1);
  assert.ok(calls.length >= 3);
  assert.ok(calls.every((c) => c.method === 'GET'));
});

test('black-friday.js skriver aldrig till Meta', () => {
  for (const f of ['netlify/functions/black-friday.js', 'netlify/functions/lib/black-friday.js']) {
    const s = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/method:\s*['"](POST|PUT|DELETE)/i.test(s), f);
    assert.ok(!/meta-write/.test(s), f);
  }
});

test('åtkomst: bara admin och DB Golf; exempeldata bara för admin', () => {
  const s = fs.readFileSync(new URL('../netlify/functions/black-friday.js', import.meta.url), 'utf8');
  assert.match(s, /!isAdmin && userId !== BF\.userId/);
  assert.match(s, /demo[\s\S]*if \(!isAdmin\)/);
});

test('köp i MATCHi: bara rader märkta Black Friday räknas, kostnad per kort på all BF-leverans', async () => {
  const { matchiSales } = await import('../netlify/functions/lib/black-friday.js');
  const input = demoInput();
  input.rows.push({ ad_id: 'a1', campaign_id: 'c1', date_start: '2026-11-24', spend: '100', impressions: '200', clicks: '3' });
  input.sales = [
    { conversion_date: '2026-11-24', courses_sold: 1, revenue_sek: '1500', notes: 'Black Friday 2026, MATCHi' },
    { conversion_date: '2026-11-26', courses_sold: 2, revenue_sek: '3000', notes: 'BF-kort' },
    { conversion_date: '2026-11-26', courses_sold: 4, revenue_sek: '2000', notes: 'Prova50' },
    { conversion_date: '2026-11-26', courses_sold: 1, revenue_sek: '800', notes: null },
  ];
  const v = buildView(input);
  assert.equal(v.matchi.cards, 3);
  assert.equal(v.matchi.revenue, 4500);
  assert.equal(v.matchi.ad_spend, v.budget.spent + v.budget.pre_start_spend);
  assert.equal(v.matchi.cost_per_card, v.matchi.ad_spend / 3);
  assert.deepEqual(v.matchi.days.map((d) => [d.date, d.cards]), [['2026-11-24', 1], ['2026-11-26', 2]]);
  const none = matchiSales([], 500);
  assert.equal(none.cards, 0);
  assert.equal(none.cost_per_card, null);
  assert.equal(none.roas, null);
  assert.equal(buildView({}).matchi.cards, 0);
});
