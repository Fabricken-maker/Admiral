import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mondayOf, lastCompletedWeekStart, completedWeekStarts, stockholmMidnight, finalAfter, isPreliminary, isoWeek,
  actionValue, weekValuesFromInsight, classifyChange, outcomeFor, compareMetric, overallVerdict,
  buildWeeklyView, listCampaigns, normalizeSettings, TOTAL_ID, PURCHASE_TYPES,
} from '../netlify/functions/lib/weekly.js';

const S = normalizeSettings({}); // tolerans 5 %, minst 300 kr och 3 resultat
const agg = (spend, results, revenue = 0) => ({ spend, results, revenue, impressions: 0 });

// ── Tid ─────────────────────────────────────────────────────────────────────
test('vecka börjar på måndag', () => {
  assert.equal(mondayOf('2026-10-05'), '2026-10-05'); // måndag
  assert.equal(mondayOf('2026-10-11'), '2026-10-05'); // söndag
  assert.equal(mondayOf('2026-10-07'), '2026-10-05');
});

test('senast avslutade vecka följer Stockholmstid, inte UTC', () => {
  // Söndag 23:30 i Stockholm (21:30 UTC): veckan 28/9–4/10 pågår fortfarande.
  assert.equal(lastCompletedWeekStart(new Date('2026-10-04T21:30:00Z')), '2026-09-21');
  // Måndag 00:30 i Stockholm (söndag 22:30 UTC): veckan 28/9–4/10 är avslutad.
  assert.equal(lastCompletedWeekStart(new Date('2026-10-04T22:30:00Z')), '2026-09-28');
  assert.deepEqual(completedWeekStarts(3, new Date('2026-10-09T10:00:00Z')), ['2026-09-14', '2026-09-21', '2026-09-28']);
});

test('midnatt i Stockholm hanterar sommar- och vintertid', () => {
  assert.equal(stockholmMidnight('2026-10-05').toISOString(), '2026-10-04T22:00:00.000Z'); // CEST
  assert.equal(stockholmMidnight('2026-10-26').toISOString(), '2026-10-25T23:00:00.000Z'); // CET
});

test('vecka är preliminär till 72 h efter veckoslut', () => {
  assert.equal(finalAfter('2026-09-28').toISOString(), '2026-10-07T22:00:00.000Z');
  assert.equal(isPreliminary('2026-09-28', '2026-10-07T21:59:00Z'), true);
  assert.equal(isPreliminary('2026-09-28', '2026-10-07T22:00:00Z'), false);
  assert.equal(isPreliminary('2026-09-28', '2026-10-09T05:15:00Z'), false);
});

test('ISO-veckonummer', () => {
  assert.equal(isoWeek('2026-09-28'), 40);
  assert.equal(isoWeek('2025-12-29'), 1);
  assert.equal(isoWeek('2026-12-28'), 53);
});

// ── Meta-insights ──────────────────────────────────────────────────────────
test('köp-typer är samma köp: största värdet, aldrig summan', () => {
  const actions = [
    { action_type: 'purchase', value: '2' },
    { action_type: 'omni_purchase', value: '2' },
    { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
    { action_type: 'link_click', value: '90' },
  ];
  assert.equal(actionValue(actions, PURCHASE_TYPES), 2);
  const v = weekValuesFromInsight({ spend: '812.456', impressions: '1000', actions, action_values: [{ action_type: 'omni_purchase', value: '2400' }] });
  assert.deepEqual(v, { spend: 812.46, results: 2, revenue: 2400, impressions: 1000 });
});

// ── Pil och utfall ─────────────────────────────────────────────────────────
test('riktning: upp, ner och oförändrat inom tolerans', () => {
  assert.equal(classifyChange(110, 100, 0.05).direction, 'up');
  assert.equal(classifyChange(90, 100, 0.05).direction, 'down');
  assert.equal(classifyChange(104, 100, 0.05).direction, 'flat');
  assert.equal(classifyChange(105, 100, 0.05).direction, 'flat'); // gränsen räknas som oförändrat
  assert.equal(classifyChange(95, 100, 0.05).direction, 'flat');
  assert.equal(classifyChange(100, 0, 0.05), null);
});

test('utfall: lägre kostnad per resultat är bättre', () => {
  assert.equal(outcomeFor('down', 'down'), 'better');
  assert.equal(outcomeFor('up', 'down'), 'worse');
  assert.equal(outcomeFor('up', 'up'), 'better');
  assert.equal(outcomeFor('down', 'up'), 'worse');
  assert.equal(outcomeFor('flat', 'down'), 'unchanged');
  assert.equal(outcomeFor('up', null), 'neutral');
});

test('kostnad per resultat ned = pil ner, märkt Bättre', () => {
  const r = compareMetric('cpr', agg(1000, 10), agg(1000, 5), S); // 100 kr mot 200 kr
  assert.equal(r.direction, 'down');
  assert.equal(r.outcome, 'better');
  assert.equal(r.word, 'Bättre');
  assert.equal(r.change, -0.5);
});

test('kostnad per resultat upp = pil upp, märkt Sämre', () => {
  const r = compareMetric('cpr', agg(1000, 4), agg(1000, 8), S);
  assert.deepEqual([r.direction, r.outcome, r.word], ['up', 'worse', 'Sämre']);
});

test('resultat upp = Bättre, ner = Sämre, nästan lika = Oförändrat', () => {
  assert.deepEqual(pick(compareMetric('results', agg(500, 12), agg(500, 10), S)), ['up', 'better', 'Bättre']);
  assert.deepEqual(pick(compareMetric('results', agg(500, 8), agg(500, 10), S)), ['down', 'worse', 'Sämre']);
  assert.deepEqual(pick(compareMetric('results', agg(500, 102), agg(500, 100), S)), ['flat', 'unchanged', 'Oförändrat']);
});

test('ROAS upp = Bättre', () => {
  assert.deepEqual(pick(compareMetric('roas', agg(1000, 5, 6000), agg(1000, 5, 4000), S)), ['up', 'better', 'Bättre']);
  assert.deepEqual(pick(compareMetric('roas', agg(1000, 5, 3000), agg(1000, 5, 4000), S)), ['down', 'worse', 'Sämre']);
});

test('spend har neutralt ord: Ökade/Minskade', () => {
  assert.deepEqual(pick(compareMetric('spend', agg(1200, 0), agg(1000, 0), S)), ['up', 'neutral', 'Ökade']);
  assert.deepEqual(pick(compareMetric('spend', agg(800, 0), agg(1000, 0), S)), ['down', 'neutral', 'Minskade']);
  assert.deepEqual(pick(compareMetric('spend', agg(1010, 0), agg(1000, 0), S)), ['flat', 'unchanged', 'Oförändrat']);
});

test('för lite data i stället för pil', () => {
  assert.equal(compareMetric('cpr', agg(1000, 2), agg(1000, 10), S).status, 'insufficient');
  assert.equal(compareMetric('cpr', agg(1000, 10), agg(1000, 2), S).status, 'insufficient');
  assert.equal(compareMetric('results', agg(1000, 5), agg(1000, 1), S).word, 'För lite data');
  assert.equal(compareMetric('spend', agg(1000, 0), agg(120, 0), S).status, 'insufficient');
  assert.equal(compareMetric('spend', agg(1000, 0), null, S).status, 'insufficient');
  // Kundens egen tröskel gäller
  const low = normalizeSettings({ min_results: 1, min_spend_sek: 50 });
  assert.equal(compareMetric('cpr', agg(1000, 2), agg(1000, 1), low).status, 'ok');
});

test('tolerans är konfigurerbar per kund', () => {
  const wide = normalizeSettings({ tolerance_pct: 15 });
  assert.equal(compareMetric('results', agg(500, 11), agg(500, 10), wide).direction, 'flat');
  assert.equal(compareMetric('results', agg(500, 11), agg(500, 10), S).direction, 'up');
});

// ── Helhetspil ─────────────────────────────────────────────────────────────
test('helhetspil: kostnad per resultat mot mål', () => {
  const s = normalizeSettings({ target_cpa: 333 });
  const good = overallVerdict(agg(3000, 12), null, s, false); // 250 kr
  assert.deepEqual([good.direction, good.outcome, good.word], ['up', 'better', 'Bättre än målet']);
  assert.equal(good.explanation, 'Kostnad per resultat 250 kr mot målet 333 kr.');
  const bad = overallVerdict(agg(3000, 6), null, s, false); // 500 kr
  assert.deepEqual([bad.direction, bad.outcome, bad.word], ['down', 'worse', 'Sämre än målet']);
  const even = overallVerdict(agg(3400, 10), null, s, false); // 340 kr, inom 5 %
  assert.deepEqual([even.direction, even.outcome, even.word], ['flat', 'unchanged', 'I linje med målet']);
});

test('helhetspil: ROAS mot mål när intäkt finns', () => {
  const s = normalizeSettings({ target_roas: 5, target_cpa: 333 });
  const v = overallVerdict(agg(1000, 4, 6000), null, s, true);
  assert.equal(v.basis.metric, 'roas');
  assert.deepEqual([v.direction, v.word], ['up', 'Bättre än målet']);
  assert.equal(v.explanation, 'ROAS 6,0 mot målet 5,0.');
  const w = overallVerdict(agg(1000, 4, 3000), null, s, true);
  assert.deepEqual([w.direction, w.outcome], ['down', 'worse']);
  // Utan intäkt används kostnadsmålet
  assert.equal(overallVerdict(agg(1000, 4), null, s, false).basis.metric, 'cpr');
});

test('helhetspil utan mål jämför mot 4-veckorssnittet', () => {
  const v = overallVerdict(agg(1000, 10), agg(1000, 5), S, false); // 100 kr mot 200 kr
  assert.equal(v.basis.against, 'average');
  assert.deepEqual([v.direction, v.word], ['up', 'Bättre än snittet']);
  assert.equal(v.explanation, 'Kostnad per resultat 100 kr mot snittet 200 kr de fyra veckorna innan.');
});

test('helhetspil: för lite data', () => {
  const s = normalizeSettings({ target_cpa: 333 });
  const v = overallVerdict(agg(3120.4, 1), null, s, false);
  assert.equal(v.status, 'insufficient');
  assert.equal(v.word, 'För lite data');
  assert.equal(v.explanation, '1 resultat på 3\u00a0120 kr. En bedömning kräver minst 3 resultat och 300 kr.');
  assert.equal(overallVerdict(agg(200, 5), null, s, false).status, 'insufficient');
  assert.equal(overallVerdict(agg(1000, 10), null, S, false).status, 'insufficient'); // inget mål, inget snitt
});

// ── Hela vyn ───────────────────────────────────────────────────────────────
const WEEKS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
const FINAL = '2026-10-09T05:15:00Z';
function rows(values, { fetchedLast = FINAL, campaign = null } = {}) {
  return WEEKS.flatMap((w, i) => {
    const [spend, results, revenue = 0] = values[i];
    const fetched_at = i === WEEKS.length - 1 ? fetchedLast : FINAL;
    const total = { ad_account_id: 'act_1', campaign_id: TOTAL_ID, campaign_name: null, week_start: w, spend, results, revenue, impressions: 0, fetched_at };
    return campaign ? [total, { ...total, campaign_id: campaign.id, campaign_name: campaign.name }] : [total];
  });
}

test('vyn: senaste veckan, pilar och diagramserie', () => {
  const data = rows([[1000, 5], [1000, 5], [1000, 5], [1000, 5], [1000, 5], [1000, 5], [1000, 5], [1200, 8]]);
  const v = buildWeeklyView(data, { target_cpa: 333 });
  assert.equal(v.status, 'ok');
  assert.equal(v.week.start, '2026-09-28');
  assert.equal(v.week.end, '2026-10-04');
  assert.equal(v.week.iso_week, 40);
  assert.equal(v.week.preliminary, false);
  assert.equal(v.series.length, 8);
  assert.deepEqual(v.metrics.map((m) => m.key), ['spend', 'results', 'cpr']); // ingen intäkt → ingen ROAS
  const cpr = v.metrics.find((m) => m.key === 'cpr');
  assert.equal(cpr.value, 150);
  assert.deepEqual([cpr.vs_prev.direction, cpr.vs_prev.word], ['down', 'Bättre']);
  assert.deepEqual([cpr.vs_avg.direction, cpr.vs_avg.word], ['down', 'Bättre']);
  assert.equal(v.metrics[0].vs_prev.word, 'Ökade');
  assert.deepEqual([v.overall.direction, v.overall.word], ['up', 'Bättre än målet']);
  assert.deepEqual(v.chart, { metric: 'cpr', label: 'Kostnad per resultat', target: 333 });
});

test('vyn: veckan märks Preliminär om den hämtats inom 72 h efter veckoslut', () => {
  const data = rows(Array(8).fill([1000, 5]), { fetchedLast: '2026-10-06T05:15:00Z' });
  const v = buildWeeklyView(data, {});
  assert.equal(v.week.preliminary, true);
  assert.equal(v.series.at(-1).preliminary, true);
  assert.equal(v.series.at(-2).preliminary, false);
});

test('vyn: ROAS visas bara när intäkt finns', () => {
  const data = rows(Array(8).fill([1000, 5, 4000]));
  const v = buildWeeklyView(data, { target_roas: 5 });
  assert.deepEqual(v.metrics.map((m) => m.key), ['spend', 'results', 'cpr', 'roas']);
  assert.equal(v.chart.metric, 'roas');
  assert.equal(v.overall.basis.metric, 'roas');
  assert.deepEqual([v.overall.direction, v.overall.word], ['down', 'Sämre än målet']); // 4,0 mot 5,0
});

test('vyn: tunt underlag ger För lite data på alla jämförande mått', () => {
  const data = rows([[0, 0], [0, 0], [0, 0], [0, 0], [3120.4, 1], [1500, 0], [900, 0], [210, 0]]);
  const v = buildWeeklyView(data, { target_cpa: 333 });
  const word = (k, side) => v.metrics.find((m) => m.key === k)[side].word;
  assert.equal(word('results', 'vs_prev'), 'För lite data');
  assert.equal(word('cpr', 'vs_prev'), 'För lite data');
  assert.equal(word('spend', 'vs_prev'), 'Minskade'); // spend 900 → 236 kr är en riktig förändring
  assert.equal(v.overall.word, 'För lite data');
  assert.equal(v.metrics.find((m) => m.key === 'cpr').value, null);
});

test('vyn: saknas 4 veckor bakåt blir snittjämförelsen För lite data', () => {
  const data = rows(Array(8).fill([1000, 5])).filter((r) => r.week_start >= '2026-09-14');
  const v = buildWeeklyView(data, {});
  assert.equal(v.series.length, 3);
  assert.equal(v.metrics[0].vs_avg.status, 'insufficient');
  assert.equal(v.metrics[0].vs_prev.status, 'ok');
});

test('vyn per kampanj och kampanjlista', () => {
  const camp = { id: '1200000000000001', name: 'Kampanj_A' };
  const data = rows(Array(8).fill([1000, 5]), { campaign: camp });
  data.push({ ad_account_id: 'act_1', campaign_id: '999', campaign_name: 'Liten', week_start: '2026-09-28', spend: 10, results: 0, revenue: 0, impressions: 0, fetched_at: FINAL });
  const v = buildWeeklyView(data, {}, { campaignId: camp.id });
  assert.equal(v.series.at(-1).spend, 1000);
  const empty = buildWeeklyView(data, {}, { campaignId: '999' });
  assert.equal(empty.series.length, 8); // veckor utan leverans räknas som 0
  assert.equal(empty.series[0].spend, 0);
  assert.deepEqual(listCampaigns(data).map((c) => c.name), ['Kampanj_A', 'Liten']);
});

test('vyn utan synkad data', () => {
  assert.equal(buildWeeklyView([], {}).status, 'no_data');
});

function pick(r) {
  return [r.direction, r.outcome, r.word];
}
