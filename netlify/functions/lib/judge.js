/**
 * Admiral Modul A (enkel version) — utlåtanden från Admirals egen data.
 *
 * Varje utlåtande är Gör / Avvakta / Avstå / För lite data, med en förklaring i en mening
 * och 2–3 stödsiffror. Allt byggs av siffror från Meta och kundens mål, aldrig av en LLM,
 * och aldrig från Metas egen bedömning (opportunity score är bara en bakgrundssignal).
 *
 * stats: { spend, results, revenue, days } för objektet.
 * settings: kundens mål och trösklar (weekly_settings): target_cpa, target_roas, min_results, min_spend_sek.
 */
import { kr } from './simulate.js';

export const VERDICTS = { gor: 'Gör', avvakta: 'Avvakta', avsta: 'Avstå', for_lite_data: 'För lite data' };
const TOLERANCE = 0.2; // ±20 % runt målet räknas som "nära målet"

const ratio = (v) => v.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function support(stats) {
  const s = [
    { label: `Spend ${stats.days} dagar`, value: kr(stats.spend) },
    { label: `Resultat ${stats.days} dagar`, value: String(stats.results) },
  ];
  if (stats.results > 0) s.push({ label: 'Kostnad per resultat', value: kr(stats.spend / stats.results) });
  return s;
}

function enoughData(stats, s) {
  return stats.results >= (s.min_results ?? 3) && stats.spend >= (s.min_spend_sek ?? 300);
}

function tooLittle(stats) {
  return {
    verdict: 'for_lite_data',
    reason: `Underlaget de senaste ${stats.days} dagarna är för litet för en bedömning (${stats.results} resultat på ${kr(stats.spend)}).`,
    support: support(stats),
  };
}

// Hur objektet presterar mot kundens mål: score > 1 = bättre än målet.
function performance(stats, s) {
  if (s.target_roas > 0 && stats.revenue > 0) {
    const roas = stats.revenue / stats.spend;
    return { score: roas / s.target_roas, text: `ROAS har varit ${ratio(roas)} de senaste ${stats.days} dagarna, målet är ${ratio(s.target_roas)}.` };
  }
  const cpr = stats.spend / stats.results;
  if (s.target_cpa > 0) {
    return { score: s.target_cpa / cpr, text: `Kostnad per resultat har varit ${kr(cpr)} de senaste ${stats.days} dagarna, målet är ${kr(s.target_cpa)}.` };
  }
  return { score: null, text: `Kostnad per resultat har varit ${kr(cpr)} de senaste ${stats.days} dagarna. Inget mål är satt.` };
}

export function judgeBudgetChange(direction, stats, s = {}) {
  if (!enoughData(stats, s)) return tooLittle(stats);
  const p = performance(stats, s);
  let verdict = 'avvakta';
  if (p.score !== null) {
    if (direction === 'up') verdict = p.score >= 1 ? 'gor' : p.score < 1 - TOLERANCE ? 'avsta' : 'avvakta';
    else verdict = p.score < 1 - TOLERANCE ? 'gor' : p.score >= 1 ? 'avsta' : 'avvakta';
  }
  return { verdict, reason: p.text, support: support(stats) };
}

// Pausa en annons: jämför annonsens kostnad per resultat med annonsuppsättningens.
export function judgeAdPause(adStats, adsetStats, s = {}) {
  if (adStats.spend < (s.min_spend_sek ?? 300)) return tooLittle(adStats);
  const sup = [
    { label: `Annonsens spend ${adStats.days} dagar`, value: kr(adStats.spend) },
    { label: 'Annonsens resultat', value: String(adStats.results) },
  ];
  const adsetCpr = adsetStats.results > 0 ? adsetStats.spend / adsetStats.results : null;
  if (adsetCpr) sup.push({ label: 'Annonsuppsättningens kostnad per resultat', value: kr(adsetCpr) });
  if (adStats.results === 0) {
    return {
      verdict: adsetCpr && adStats.spend >= 2 * adsetCpr ? 'gor' : 'avvakta',
      reason: `Annonsen har kostat ${kr(adStats.spend)} utan resultat de senaste ${adStats.days} dagarna${adsetCpr ? `; annonsuppsättningen har ${kr(adsetCpr)} per resultat` : ''}.`,
      support: sup,
    };
  }
  const adCpr = adStats.spend / adStats.results;
  const verdict = adsetCpr ? (adCpr > adsetCpr * 1.5 ? 'gor' : adCpr < adsetCpr ? 'avsta' : 'avvakta') : 'avvakta';
  return {
    verdict,
    reason: `Annonsen har kostat ${kr(adCpr)} per resultat de senaste ${adStats.days} dagarna${adsetCpr ? `, annonsuppsättningen ${kr(adsetCpr)}` : ''}.`,
    support: sup,
  };
}

export function judgeAdResume(adStats) {
  return {
    verdict: 'avvakta',
    reason: adStats.results > 0
      ? `Annonsen gav ${adStats.results} resultat på ${kr(adStats.spend)} de ${adStats.days} dagarna före pausen.`
      : `Annonsen har ingen leverans de senaste ${adStats.days} dagarna att bedöma från.`,
    support: support(adStats),
  };
}

// Metas rekommendationer. Bara typer Admiral kan bedöma från egen data och ångra får utlåtandet Gör.
export const APPLICABLE_RECOMMENDATIONS = ['SCALE_GOOD_CAMPAIGN'];

export function judgeRecommendation(rec, stats, s = {}) {
  if (!APPLICABLE_RECOMMENDATIONS.includes(rec.type)) {
    return { verdict: 'avvakta', reason: 'Typen bedöms inte automatiskt av Admiral.', support: stats ? support(stats) : [] };
  }
  if (!rec.recommendation_signature) {
    return { verdict: 'avvakta', reason: 'Meta tillåter inte att rekommendationen appliceras via API.', support: stats ? support(stats) : [] };
  }
  return judgeBudgetChange('up', stats, s);
}
