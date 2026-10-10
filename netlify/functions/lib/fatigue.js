/**
 * Admiral Modul E — kreativ trötthet (ren logik, inga nätverksanrop).
 *
 * En annons är trött när, jämfört med annonsens egen baslinje (dess första veckor med
 * tillräcklig data), den senast avslutade veckan visar:
 *   - frekvens upp (minst min_frequency och minst frequency_rise_pct högre), och
 *   - CTR ned (minst ctr_drop_pct lägre), och
 *   - kostnad per resultat upp (minst cpa_rise_pct högre) — när resultaten räcker för att bedöma.
 * Räcker inte resultaten avgör frekvens och CTR. Är kostnaden per resultat fortfarande bra
 * flaggas annonsen inte. Under datatröskeln flaggas ingenting.
 *
 * Alla siffror räknas här. Texterna byggs av siffrorna, aldrig av en språkmodell.
 */
import { actionValue, PURCHASE_TYPES, classifyChange, outcomeFor, wordFor } from './weekly.js';

export const DEFAULT_FATIGUE_SETTINGS = {
  enabled: true,
  lookback_weeks: 10,
  baseline_weeks: 2,
  min_impressions_week: 1000,
  min_spend_week_sek: 100,
  min_results: 3,
  min_frequency: 2.5,
  frequency_rise_pct: 20,
  ctr_drop_pct: 20,
  cpa_rise_pct: 20,
  copy_variants: 2,
};

export function normalizeFatigueSettings(row) {
  const s = { ...DEFAULT_FATIGUE_SETTINGS };
  for (const k of Object.keys(s)) if (row && row[k] !== null && row[k] !== undefined) s[k] = row[k];
  for (const k of Object.keys(s)) if (k !== 'enabled') s[k] = Number(s[k]);
  s.enabled = row?.enabled !== false;
  return s;
}

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const round = (v, d = 4) => (v === null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);

// En veckorad från Meta (insights, level=ad, time_increment=7) → siffror för veckan.
export function weekFromInsight(row, resultTypes = PURCHASE_TYPES) {
  const impressions = Math.round(num(row.impressions));
  const reach = Math.round(num(row.reach));
  const clicks = Math.round(num(row.inline_link_clicks ?? row.clicks));
  const spend = num(row.spend);
  const results = actionValue(row.actions, resultTypes);
  return {
    week_start: row.date_start,
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : num(row.frequency),
    clicks,
    spend,
    results,
  };
}

// Summerar veckor. Frekvensen är snittet av veckornas frekvens (räckvidd kan inte summeras).
export function aggregate(weeks) {
  if (!weeks.length) return null;
  const sum = (k) => weeks.reduce((a, w) => a + w[k], 0);
  const impressions = sum('impressions');
  const clicks = sum('clicks');
  const spend = sum('spend');
  const results = sum('results');
  return {
    weeks: weeks.map((w) => w.week_start),
    impressions,
    clicks,
    spend: round(spend, 2),
    results,
    frequency: round(weeks.reduce((a, w) => a + w.frequency, 0) / weeks.length, 2),
    ctr: impressions > 0 ? round(clicks / impressions, 6) : null,
    cpa: results > 0 ? round(spend / results, 2) : null,
  };
}

const isValid = (w, s) => w.impressions >= s.min_impressions_week && w.spend >= s.min_spend_week_sek;

/**
 * weeks: annonsens veckor i tidsordning (weekFromInsight). lastWeekStart: senast avslutade vecka.
 * → { status: 'trott' | 'ok' | 'for_lite_data', reason?, metrics?, signals? }
 */
export function assessAd(weeks, settingsRow, lastWeekStart) {
  const s = normalizeFatigueSettings(settingsRow);
  const sorted = [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const recentWeek = sorted.find((w) => w.week_start === lastWeekStart);
  if (!recentWeek || !isValid(recentWeek, s)) return { status: 'for_lite_data', reason: 'Förra veckan har för lite data.' };
  const earlier = sorted.filter((w) => w.week_start < lastWeekStart && isValid(w, s));
  if (earlier.length < s.baseline_weeks) return { status: 'for_lite_data', reason: 'Annonsen har för få veckor med data att jämföra med.' };

  const baseline = aggregate(earlier.slice(0, s.baseline_weeks));
  const recent = aggregate([recentWeek]);
  const change = {
    frequency: baseline.frequency > 0 ? round(recent.frequency / baseline.frequency - 1) : null,
    ctr: baseline.ctr > 0 && recent.ctr !== null ? round(recent.ctr / baseline.ctr - 1) : null,
    cpa: baseline.cpa > 0 && recent.cpa !== null ? round(recent.cpa / baseline.cpa - 1) : null,
  };

  const frequencyUp = recent.frequency >= s.min_frequency && change.frequency !== null && change.frequency >= s.frequency_rise_pct / 100 - 1e-9;
  const ctrDown = change.ctr !== null && change.ctr <= -s.ctr_drop_pct / 100 + 1e-9;
  // Kostnad per resultat bedöms bara när baslinjen har tillräckligt många resultat. Inga resultat
  // alls förra veckan (men en giltig vecka med spend) räknas som högre kostnad.
  let cpaUp = null;
  if (baseline.results >= s.min_results && baseline.cpa > 0) {
    cpaUp = recent.results === 0 ? true : recent.results >= s.min_results ? change.cpa >= s.cpa_rise_pct / 100 - 1e-9 : null;
  }

  const signals = { frequency_up: frequencyUp, ctr_down: ctrDown, cpa_up: cpaUp };
  const metrics = { baseline, recent, change, week_start: lastWeekStart };
  const tired = frequencyUp && ctrDown && cpaUp !== false;
  return { status: tired ? 'trott' : 'ok', metrics, signals };
}

// Grupperar Metas veckorader per annons och bedömer varje annons.
export function assessAccount(rows, settingsRow, lastWeekStart, resultTypes = PURCHASE_TYPES) {
  const byAd = new Map();
  for (const r of rows) {
    if (!byAd.has(r.ad_id)) byAd.set(r.ad_id, { ad: { ad_id: r.ad_id, ad_name: r.ad_name, adset_id: r.adset_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name }, weeks: [] });
    byAd.get(r.ad_id).weeks.push(weekFromInsight(r, resultTypes));
  }
  return [...byAd.values()].map(({ ad, weeks }) => ({ ...ad, ...assessAd(weeks, settingsRow, lastWeekStart) }));
}

// ── Texter (byggs av siffror) ─────────────────────────────────────────────
const dec1 = (v) => v.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctSigned = (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 100)).toLocaleString('sv-SE')} %`;
const pctCtr = (v) => `${(v * 100).toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} %`;
const kr = (v) => `${Math.round(v).toLocaleString('sv-SE')} kr`;
const q = (name) => `”${name}”`;

export function fatigueSummary(m) {
  const parts = [`frekvens ${dec1(m.recent.frequency)}`];
  if (m.change.ctr !== null) parts.push(`CTR ${pctSigned(m.change.ctr)}`);
  if (m.change.cpa !== null && m.change.cpa > 0) parts.push(`kostnad per resultat ${pctSigned(m.change.cpa)}`);
  return parts.join(', ');
}

export function fatigueReason(adName, m, variantLabel) {
  const head = `Annonsen ${q(adName)} tappar effekt (${fatigueSummary(m)}).`;
  return variantLabel ? `${head} Förslag: byt till variant ${variantLabel}.` : head;
}

// Förväntat utfall: att den nya annonsen når den gamla annonsens första veckor (baslinjen).
export function expectedOutcome(m) {
  const { baseline: b, recent: r } = m;
  if (b.cpa > 0 && b.results >= 1) {
    const now = r.results > 0 ? `i stället för ${kr(r.cpa)}` : 'i stället för inga resultat förra veckan';
    return {
      text: `Om den nya annonsen når den gamla annonsens första veckor blir kostnaden per resultat cirka ${kr(b.cpa)} ${now}.`,
      basis: 'baseline_cpa', baseline_cpa: b.cpa, recent_cpa: r.cpa,
    };
  }
  return {
    text: `Om den nya annonsen når den gamla annonsens första veckor blir klickfrekvensen cirka ${pctCtr(b.ctr)} i stället för ${pctCtr(r.ctr)}.`,
    basis: 'baseline_ctr', baseline_ctr: b.ctr, recent_ctr: r.ctr,
  };
}

// ── Uppföljning efter bytet (visas i veckovyn) ────────────────────────────
const FOLLOW_METRICS = [
  { key: 'ctr', label: 'CTR', better: 'up' },
  { key: 'cpa', label: 'Kostnad per resultat', better: 'down' },
  { key: 'frequency', label: 'Frekvens', better: 'down' },
];
const FOLLOW_TOLERANCE = 0.05;

/**
 * before: den gamla annonsens senaste vecka före bytet (aggregate), after: den nya annonsen sedan bytet.
 * Jämför bara när den nya annonsen har tillräckligt med data.
 */
export function compareFollowup(before, after, settingsRow) {
  const s = normalizeFatigueSettings(settingsRow);
  if (!after || after.impressions < s.min_impressions_week) {
    return { status: 'insufficient', word: 'För lite data', metrics: [] };
  }
  const metrics = FOLLOW_METRICS.map((m) => {
    if (m.key === 'cpa' && (after.results < s.min_results || !(before?.cpa > 0))) return { ...m, status: 'insufficient', word: 'För lite data' };
    const c = classifyChange(after[m.key], before?.[m.key] ?? null, FOLLOW_TOLERANCE);
    if (!c) return { ...m, status: 'insufficient', word: 'För lite data' };
    const outcome = outcomeFor(c.direction, m.better);
    return { ...m, status: 'ok', direction: c.direction, outcome, word: wordFor(c.direction, outcome), change: round(c.change), before: before[m.key], after: after[m.key] };
  });
  return { status: 'ok', metrics };
}
