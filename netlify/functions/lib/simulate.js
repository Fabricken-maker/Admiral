/**
 * Admiral — enkel budgetsimulator (Modul D).
 *
 * Räknar ut förväntat utfall av en budgetändring från objektets egna siffror de senaste
 * 28 dagarna. Inga LLM-siffror: allt här är aritmetik på källdata.
 *
 * Antaganden (redovisas i expected_outcome.assumptions):
 *  - En månad = 30,4 dagar och dagsbudgeten förbrukas fullt ut.
 *  - Extra eller borttagen budget ger/tar bort resultat till en kostnad som är 20 % högre än
 *    snittkostnaden per resultat (avtagande avkastning: de dyraste resultaten påverkas först).
 */
export const DAYS_PER_MONTH = 30.4;
export const MARGINAL_COST_FACTOR = 1.2;

export const monthlyFromDailyCents = (cents) => Math.round((Number(cents) / 100) * DAYS_PER_MONTH);

export function kr(v) {
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
}

const signedKr = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${kr(Math.abs(v))}`;
const signedInt = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v)).toLocaleString('sv-SE')}`;

/**
 * budgets: { before: { id: cents }, after: { id: cents } }
 * stats: { spend, results, revenue } för de senaste 28 dagarna (summa för objekten)
 * settings: { min_results, min_spend_sek }
 */
export function simulateBudget({ before, after, stats = {}, settings = {} }) {
  const sum = (m) => Object.values(m).reduce((a, c) => a + Number(c), 0);
  const monthlyBefore = monthlyFromDailyCents(sum(before));
  const monthlyAfter = monthlyFromDailyCents(sum(after));
  const delta = monthlyAfter - monthlyBefore;

  const minResults = settings.min_results ?? 3;
  const minSpend = settings.min_spend_sek ?? 300;
  const enough = Number(stats.results) >= minResults && Number(stats.spend) >= minSpend;

  const out = {
    monthly_before_sek: monthlyBefore,
    monthly_after_sek: monthlyAfter,
    monthly_delta_sek: delta,
    basis: { days: 28, spend_sek: round2(stats.spend || 0), results: Number(stats.results || 0), revenue_sek: round2(stats.revenue || 0) },
    assumptions: { days_per_month: DAYS_PER_MONTH, marginal_cost_factor: MARGINAL_COST_FACTOR },
  };

  if (enough && delta !== 0) {
    const cpr = stats.spend / stats.results;
    const marginal = cpr * MARGINAL_COST_FACTOR;
    out.cost_per_result_sek = Math.round(cpr);
    out.results_delta = Math.round(delta / marginal);
    if (stats.revenue > 0) out.revenue_delta_sek = Math.round(out.results_delta * (stats.revenue / stats.results));
  }

  const parts = [`${signedKr(delta)}/mån i spend`];
  if (out.results_delta !== undefined) parts.push(`ca ${signedInt(out.results_delta)} resultat/mån`);
  if (out.revenue_delta_sek !== undefined) parts.push(`ca ${signedKr(out.revenue_delta_sek)}/mån i intäkt`);
  out.text = `${capitalize(joinSv(parts))}.${out.results_delta === undefined && delta !== 0 ? ' För lite data för att uppskatta resultat.' : ''}`;
  return out;
}

// Pausa/återstarta en annons: budgeten ligger på annonsuppsättningen, så pengarna flyttas
// mellan annonserna i den. Utfallet i kronor är annonsens egen spend.
export function simulateAdStatus({ to, adStats = {}, adsetMonthlySek = null }) {
  const monthly = Math.round(((adStats.spend || 0) / 28) * DAYS_PER_MONTH);
  if (to === 'PAUSED') {
    return {
      monthly_moved_sek: monthly,
      basis: { days: 28, spend_sek: round2(adStats.spend || 0), results: Number(adStats.results || 0) },
      text: monthly > 0
        ? `Ca ${kr(monthly)}/mån flyttas till övriga annonser i annonsuppsättningen.`
        : 'Annonsen har inte kostat något de senaste 28 dagarna.',
    };
  }
  return {
    adset_monthly_sek: adsetMonthlySek,
    text: `Annonsen visas igen inom annonsuppsättningens budget${adsetMonthlySek ? ` (${kr(adsetMonthlySek)}/mån)` : ''}. Meta kan granska annonsen innan den visas.`,
  };
}

function joinSv(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}`;
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (v) => Math.round(Number(v) * 100) / 100;
