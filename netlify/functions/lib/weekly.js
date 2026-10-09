/**
 * Admiral Modul C — Veckoutveckling (ren logik, inga nätverksanrop)
 *
 * Siffrorna kommer alltid från weekly_metrics (synkade från Meta av weekly-sync).
 * Här räknas bara veckogränser, preliminär-regeln, pilar och utfall.
 *
 * Regler:
 *  - Vecka = måndag–söndag, Europe/Stockholm.
 *  - En vecka är "Preliminär" tills 72 h efter veckoslut (Meta justerar i efterhand).
 *    Avgörs av när raden hämtades: hämtad före gränsen = preliminär.
 *  - Pilen visar riktning (upp/ner/oförändrat). Ordet och färgen visar utfall
 *    (Bättre/Sämre/Oförändrat). Kostnad per resultat: lägre är bättre.
 *    Spend är varken bättre eller sämre i sig och får neutralt ord (Ökade/Minskade).
 *  - Oförändrat = förändring inom ±tolerans (standard 5 %).
 *  - Under kundens datatröskel visas "För lite data" i stället för pil.
 *  - Helhetspilen jämför veckans ROAS (om intäkt och ROAS-mål finns) annars
 *    kostnad per resultat mot kundens mål. Saknas mål jämförs mot 4-veckorssnittet.
 *    Där betyder upp = bättre än målet.
 */

// purchase, omni_purchase och offsite_conversion.fb_pixel_purchase är olika vyer av
// SAMMA köp. Resultat = största värdet bland kundens resultattyper, aldrig summan.
export const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];

export const DEFAULT_SETTINGS = {
  tolerance_pct: 5,
  min_spend_sek: 300,
  min_results: 3,
  result_action_types: PURCHASE_TYPES,
  target_cpa: null,
  target_roas: null,
};

export const TOTAL_ID = '_konto'; // campaign_id för kontots veckosumma
export const WEEKS_SHOWN = 8;
export const BASELINE_WEEKS = 4;
export const PRELIMINARY_HOURS = 72;

const TZ = 'Europe/Stockholm';

// ── Tid ─────────────────────────────────────────────────────────────────────
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function stockholmDate(d = new Date()) {
  return dayFmt.format(d); // YYYY-MM-DD
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay() || 7;
  return addDays(dateStr, 1 - dow);
}

// Måndagen i senast avslutade vecka (mån–sön) i Stockholm.
export function lastCompletedWeekStart(now = new Date()) {
  return addDays(mondayOf(stockholmDate(now)), -7);
}

// De n senaste avslutade veckorna, äldst först.
export function completedWeekStarts(n, now = new Date()) {
  const last = lastCompletedWeekStart(now);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

function tzOffsetMinutes(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - d.getTime()) / 60000);
}

// UTC-ögonblicket för 00:00 Stockholmstid ett visst datum.
export function stockholmMidnight(dateStr) {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
}

// Veckan räknas som slutlig först när den hämtats minst 72 h efter veckoslut.
export function finalAfter(weekStart) {
  return new Date(stockholmMidnight(addDays(weekStart, 7)).getTime() + PRELIMINARY_HOURS * 3600_000);
}

export function isPreliminary(weekStart, fetchedAt) {
  return new Date(fetchedAt) < finalAfter(weekStart);
}

export function isoWeek(dateStr) {
  const t = new Date(`${dateStr}T12:00:00Z`);
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

// ── Meta-insights → veckorad ────────────────────────────────────────────────
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));

export function actionValue(list, types) {
  return (list || [])
    .filter((a) => types.includes(a.action_type))
    .reduce((max, a) => Math.max(max, num(a.value)), 0);
}

export function weekValuesFromInsight(row = {}, resultTypes = PURCHASE_TYPES) {
  return {
    spend: round(num(row.spend), 2),
    results: actionValue(row.actions, resultTypes),
    revenue: round(actionValue(row.action_values, resultTypes), 2),
    impressions: Math.round(num(row.impressions)),
  };
}

// ── Jämförelser ─────────────────────────────────────────────────────────────
export const METRICS = {
  spend:   { label: 'Spend', unit: 'kr', better: null },
  results: { label: 'Resultat', unit: 'st', better: 'up' },
  cpr:     { label: 'Kostnad per resultat', unit: 'kr', better: 'down' },
  roas:    { label: 'ROAS', unit: 'x', better: 'up' },
};

const OUTCOME_WORD = { better: 'Bättre', worse: 'Sämre', unchanged: 'Oförändrat' };
const NEUTRAL_WORD = { up: 'Ökade', down: 'Minskade', flat: 'Oförändrat' };

// Riktning för en förändring. ref måste vara > 0 för att en procentsats ska finnas.
export function classifyChange(cur, ref, tolerance) {
  if (cur === null || ref === null || !(ref > 0)) return null;
  const change = (cur - ref) / ref;
  if (Math.abs(change) <= tolerance + 1e-9) return { direction: 'flat', change };
  return { direction: change > 0 ? 'up' : 'down', change };
}

export function outcomeFor(direction, better) {
  if (direction === 'flat') return 'unchanged';
  if (!better) return 'neutral';
  return direction === better ? 'better' : 'worse';
}

export function wordFor(direction, outcome) {
  return outcome === 'neutral' ? NEUTRAL_WORD[direction] : OUTCOME_WORD[outcome];
}

export function metricValue(key, agg) {
  if (!agg) return null;
  switch (key) {
    case 'spend': return agg.spend;
    case 'results': return agg.results;
    case 'cpr': return agg.results > 0 ? agg.spend / agg.results : null;
    case 'roas': return agg.spend > 0 ? agg.revenue / agg.spend : null;
    default: return null;
  }
}

// Räcker underlaget för att jämföra måttet mellan cur och ref?
export function hasEnoughData(key, cur, ref, s) {
  if (!cur || !ref) return false;
  const spendOk = (a) => a.spend >= s.min_spend_sek;
  const resOk = (a) => a.results >= s.min_results;
  switch (key) {
    case 'spend': return spendOk(ref);
    case 'results': return resOk(ref);
    case 'cpr': return resOk(cur) && resOk(ref);
    case 'roas': return spendOk(cur) && spendOk(ref) && resOk(cur) && resOk(ref);
    default: return false;
  }
}

export function compareMetric(key, cur, ref, s) {
  if (!hasEnoughData(key, cur, ref, s)) return { status: 'insufficient', word: 'För lite data' };
  const c = classifyChange(metricValue(key, cur), metricValue(key, ref), s.tolerance_pct / 100);
  if (!c) return { status: 'insufficient', word: 'För lite data' };
  const outcome = outcomeFor(c.direction, METRICS[key].better);
  return { status: 'ok', direction: c.direction, outcome, word: wordFor(c.direction, outcome), change: round(c.change, 4) };
}

// ── Helhetspil ──────────────────────────────────────────────────────────────
export function overallVerdict(cur, baseline, s, hasRevenue) {
  const tol = s.tolerance_pct / 100;
  let basis;
  if (hasRevenue && s.target_roas > 0) basis = { metric: 'roas', against: 'goal', target: Number(s.target_roas) };
  else if (s.target_cpa > 0) basis = { metric: 'cpr', against: 'goal', target: Number(s.target_cpa) };
  else {
    const metric = hasRevenue ? 'roas' : 'cpr';
    const target = baseline && hasEnoughData(metric, cur, baseline, s) ? metricValue(metric, baseline) : null;
    basis = { metric, against: 'average', target };
  }

  const value = metricValue(basis.metric, cur);
  const enough = cur && cur.spend >= s.min_spend_sek && cur.results >= s.min_results;
  if (!enough || value === null) {
    return { status: 'insufficient', word: 'För lite data', basis, value, explanation: insufficientText(cur, s) };
  }
  if (!(basis.target > 0)) {
    return { status: 'insufficient', word: 'För lite data', basis, value, explanation: 'Inget mål är satt och veckorna innan har för lite data att jämföra med.' };
  }

  // score > 1 = bättre än referensen, oavsett om måttet ska upp (ROAS) eller ner (kostnad).
  const score = basis.metric === 'roas' ? value / basis.target : basis.target / value;
  let direction = 'flat';
  if (score >= 1 + tol - 1e-9) direction = 'up';
  else if (score <= 1 - tol + 1e-9) direction = 'down';
  const outcome = direction === 'up' ? 'better' : direction === 'down' ? 'worse' : 'unchanged';
  const ref = basis.against === 'goal' ? 'målet' : 'snittet';
  const word = outcome === 'better' ? `Bättre än ${ref}` : outcome === 'worse' ? `Sämre än ${ref}` : `I linje med ${ref}`;
  return { status: 'ok', direction, outcome, word, basis, value: round(value, 4), explanation: verdictText(basis, value) };
}

// ── Text (byggs bara av siffror, aldrig av en LLM) ──────────────────────────
export function kr(v) {
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
}

export function ratio(v) {
  return v.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function verdictText(basis, value) {
  const fmt = basis.metric === 'roas' ? ratio : kr;
  const name = basis.metric === 'roas' ? 'ROAS' : 'Kostnad per resultat';
  const ref = basis.against === 'goal' ? `målet ${fmt(basis.target)}` : `snittet ${fmt(basis.target)} de fyra veckorna innan`;
  return `${name} ${fmt(value)} mot ${ref}.`;
}

function insufficientText(cur, s) {
  if (!cur) return null;
  const res = cur.results === 1 ? '1 resultat' : `${cur.results.toLocaleString('sv-SE')} resultat`;
  return `${res} på ${kr(cur.spend)}. En bedömning kräver minst ${s.min_results} resultat och ${kr(s.min_spend_sek)}.`;
}

// ── Vy ──────────────────────────────────────────────────────────────────────
export function normalizeSettings(row = {}) {
  const pick = (k) => (row[k] === null || row[k] === undefined ? DEFAULT_SETTINGS[k] : row[k]);
  return {
    tolerance_pct: Number(pick('tolerance_pct')),
    min_spend_sek: Number(pick('min_spend_sek')),
    min_results: Number(pick('min_results')),
    result_action_types: pick('result_action_types'),
    target_cpa: row.target_cpa === null || row.target_cpa === undefined ? null : Number(row.target_cpa),
    target_roas: row.target_roas === null || row.target_roas === undefined ? null : Number(row.target_roas),
  };
}

function emptyAgg(weekStart) {
  return { week_start: weekStart, spend: 0, results: 0, revenue: 0, impressions: 0, preliminary: false, fetched_at: null };
}

function addInto(agg, row) {
  agg.spend = round(agg.spend + num(row.spend), 2);
  agg.results += num(row.results);
  agg.revenue = round(agg.revenue + num(row.revenue), 2);
  agg.impressions += num(row.impressions);
  if (isPreliminary(row.week_start, row.fetched_at)) agg.preliminary = true;
  if (!agg.fetched_at || new Date(row.fetched_at) < new Date(agg.fetched_at)) agg.fetched_at = row.fetched_at;
}

/**
 * rows: weekly_metrics för en kund (kontosummor med campaign_id = TOTAL_ID och kampanjrader).
 * campaignId: null = alla kampanjer (kontosummor), annars en kampanj.
 */
export function buildWeeklyView(rows, settingsRow, { campaignId = null } = {}) {
  const s = normalizeSettings(settingsRow);
  const totals = rows.filter((r) => r.campaign_id === TOTAL_ID);

  // Synkade veckor = veckor där kontosumman finns. Visa de senaste WEEKS_SHOWN.
  const synced = [...new Set(totals.map((r) => r.week_start))].sort();
  const weeks = synced.slice(-WEEKS_SHOWN);
  if (!weeks.length) return { status: 'no_data', settings: publicSettings(s) };

  const byWeek = new Map(weeks.map((w) => [w, emptyAgg(w)]));
  const source = campaignId ? rows.filter((r) => r.campaign_id === campaignId) : totals;
  for (const r of source) if (byWeek.has(r.week_start)) addInto(byWeek.get(r.week_start), r);
  // Preliminärflaggan följer kontosumman även för kampanjer utan leverans den veckan.
  for (const t of totals) if (byWeek.has(t.week_start) && isPreliminary(t.week_start, t.fetched_at)) byWeek.get(t.week_start).preliminary = true;

  const series = weeks.map((w) => byWeek.get(w));
  const cur = series.at(-1);
  const prevWeek = addDays(cur.week_start, -7);
  const prev = byWeek.get(prevWeek) || null;

  const baseWeeks = Array.from({ length: BASELINE_WEEKS }, (_, i) => addDays(cur.week_start, -7 * (i + 1)));
  const baseline = baseWeeks.every((w) => byWeek.has(w)) ? average(baseWeeks.map((w) => byWeek.get(w))) : null;

  const hasRevenue = series.some((w) => w.revenue > 0);
  const keys = hasRevenue ? ['spend', 'results', 'cpr', 'roas'] : ['spend', 'results', 'cpr'];
  const metrics = keys.map((key) => ({
    key,
    label: METRICS[key].label,
    unit: METRICS[key].unit,
    value: roundOrNull(metricValue(key, cur)),
    vs_prev: compareMetric(key, cur, prev, s),
    vs_avg: baseline ? compareMetric(key, cur, baseline, s) : { status: 'insufficient', word: 'För lite data' },
  }));

  const overall = overallVerdict(cur, baseline, s, hasRevenue);
  const chartMetric = hasRevenue ? 'roas' : 'cpr';
  const chartTarget = chartMetric === 'roas' ? s.target_roas : s.target_cpa;

  return {
    status: 'ok',
    week: {
      start: cur.week_start,
      end: addDays(cur.week_start, 6),
      iso_week: isoWeek(cur.week_start),
      preliminary: cur.preliminary,
      final_after: finalAfter(cur.week_start).toISOString(),
    },
    overall,
    metrics,
    series: series.map((w) => ({
      week_start: w.week_start,
      iso_week: isoWeek(w.week_start),
      spend: w.spend,
      results: w.results,
      revenue: w.revenue,
      cpr: roundOrNull(metricValue('cpr', w)),
      roas: roundOrNull(metricValue('roas', w)),
      preliminary: w.preliminary,
    })),
    chart: { metric: chartMetric, label: METRICS[chartMetric].label, target: chartTarget },
    settings: publicSettings(s),
  };
}

// Kampanjer som haft spend under de visade veckorna, störst först.
export function listCampaigns(rows) {
  const totals = rows.filter((r) => r.campaign_id === TOTAL_ID);
  const weeks = new Set([...new Set(totals.map((r) => r.week_start))].sort().slice(-WEEKS_SHOWN));
  const m = new Map();
  for (const r of rows) {
    if (r.campaign_id === TOTAL_ID || !weeks.has(r.week_start)) continue;
    const c = m.get(r.campaign_id) || { id: r.campaign_id, name: r.campaign_name, spend: 0 };
    c.spend = round(c.spend + num(r.spend), 2);
    if (r.campaign_name) c.name = r.campaign_name;
    m.set(r.campaign_id, c);
  }
  return [...m.values()].filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend);
}

function average(list) {
  const n = list.length;
  const sum = (k) => list.reduce((a, w) => a + w[k], 0);
  return { spend: sum('spend') / n, results: sum('results') / n, revenue: sum('revenue') / n, impressions: sum('impressions') / n };
}

function publicSettings(s) {
  return { tolerance_pct: s.tolerance_pct, min_spend_sek: s.min_spend_sek, min_results: s.min_results, target_cpa: s.target_cpa, target_roas: s.target_roas };
}

export function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function roundOrNull(v) {
  return v === null || v === undefined ? null : round(v, 2);
}
