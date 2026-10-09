/**
 * Admiral Modul D — förslag: värden, gränser och texter (ren logik, inga nätverksanrop).
 *
 * Värdemodell:
 *   budget_change, apply_recommendation: { budgets: { "<objekt-id>": dagsbudget i öre } }
 *   ad_status:                           { status: "ACTIVE" | "PAUSED" }
 */
import { kr, monthlyFromDailyCents } from './simulate.js';

export const DEFAULT_WRITE_SETTINGS = {
  writes_enabled: false,
  kill_switch: false,
  ad_account_ids: [],
  max_change_pct_per_action: 30,
  max_change_sek_per_action: 1500,
  max_change_sek_per_period: 3000,
  max_actions_per_period: 10,
  period_days: 30,
  monthly_budget_cap_sek: null,
  approval_ttl_hours: 72,
};

export function normalizeWriteSettings(row) {
  const s = { ...DEFAULT_WRITE_SETTINGS };
  for (const k of Object.keys(s)) if (row && row[k] !== null && row[k] !== undefined) s[k] = row[k];
  for (const k of ['max_change_pct_per_action', 'max_change_sek_per_action', 'max_change_sek_per_period', 'max_actions_per_period', 'period_days', 'approval_ttl_hours']) s[k] = Number(s[k]);
  if (s.monthly_budget_cap_sek !== null) s.monthly_budget_cap_sek = Number(s.monthly_budget_cap_sek);
  return s;
}

const sumBudgets = (v) => Object.values(v?.budgets || {}).reduce((a, c) => a + Number(c), 0);
export const isBudgetType = (type) => type === 'budget_change' || type === 'apply_recommendation';

// Ändring i kr/mån som en åtgärd innebär (0 för annonsstatus).
export function monthlyDelta(type, current, proposed) {
  if (!isBudgetType(type)) return 0;
  return monthlyFromDailyCents(sumBudgets(proposed)) - monthlyFromDailyCents(sumBudgets(current));
}

export function sameValue(type, a, b) {
  if (isBudgetType(type)) {
    const ka = Object.keys(a?.budgets || {}).sort();
    const kb = Object.keys(b?.budgets || {}).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Number(a.budgets[k]) === Number(b.budgets[k]));
  }
  return a?.status === b?.status;
}

/**
 * Gränser per kund. Ångra (kind 'undo') återställer ett tidigare läge och prövas bara mot
 * nödstopp och skrivbehörighet, inte mot gränserna.
 *
 * periodWrites: genomförda skrivningar inom perioden: [{ monthly_delta_sek }]
 * delivery: { delivering: boolean, accountDailyCents: summa dagsbudget för levererande objekt }
 */
export function checkLimits({ type, kind = 'change', current, proposed, settings, periodWrites = [], delivery = null }) {
  const s = normalizeWriteSettings(settings);
  const errors = [];
  if (sameValue(type, current, proposed)) errors.push('Föreslaget värde är samma som nuvarande.');
  if (kind === 'undo') return { ok: errors.length === 0, errors };

  const n = periodWrites.length;
  if (n + 1 > s.max_actions_per_period) {
    errors.push(`${n} ändringar har redan gjorts de senaste ${s.period_days} dagarna. Gränsen är ${s.max_actions_per_period}.`);
  }
  if (isBudgetType(type)) {
    const before = sumBudgets(current);
    const after = sumBudgets(proposed);
    const delta = monthlyDelta(type, current, proposed);
    if (before > 0) {
      const pct = Math.round((Math.abs(after - before) / before) * 100);
      if (pct > s.max_change_pct_per_action) errors.push(`Ändringen är ${pct} % av nuvarande budget. Gränsen är ${s.max_change_pct_per_action} % per åtgärd.`);
    }
    if (Math.abs(delta) > s.max_change_sek_per_action) {
      errors.push(`Ändringen är ${kr(Math.abs(delta))}/mån. Gränsen är ${kr(s.max_change_sek_per_action)}/mån per åtgärd.`);
    }
    const periodSum = periodWrites.reduce((a, w) => a + Math.abs(Number(w.monthly_delta_sek || 0)), 0) + Math.abs(delta);
    if (periodSum > s.max_change_sek_per_period) {
      errors.push(`Ändringarna de senaste ${s.period_days} dagarna blir ${kr(periodSum)}/mån. Gränsen är ${kr(s.max_change_sek_per_period)}/mån.`);
    }
    if (delta > 0 && delivery?.delivering) {
      if (s.monthly_budget_cap_sek === null) {
        errors.push('Inget budgettak är satt för kunden. Budgeten kan inte höjas för annonser som visas.');
      } else {
        const total = monthlyFromDailyCents(delivery.accountDailyCents - before + after);
        if (total > s.monthly_budget_cap_sek) errors.push(`Kontots månadsbudget blir ${kr(total)}. Taket är ${kr(s.monthly_budget_cap_sek)}.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── Texter (byggs av siffror) ─────────────────────────────────────────────
const sek = (cents) => kr(Number(cents) / 100);
const q = (name) => `”${name}”`;

export function describe(p) {
  const prefix = p.kind === 'undo' ? 'Ångra: ' : '';
  if (p.type === 'ad_status') {
    return `${prefix}${p.proposed_value.status === 'PAUSED' ? 'Pausa' : 'Starta'} annonsen ${q(p.object_name)}${p.proposed_value.status === 'PAUSED' ? '' : ' igen'}.`;
  }
  const before = sumBudgets(p.current_value);
  const after = sumBudgets(p.proposed_value);
  if (p.type === 'apply_recommendation') {
    return `${prefix}Öka budgeten för ${q(p.object_name)} enligt Metas rekommendation, från ${sek(before)} till ${sek(after)} per dag.`;
  }
  const verb = after > before ? 'Höj' : 'Sänk';
  const what = Object.keys(p.proposed_value.budgets).length > 1 ? 'dagsbudgetarna' : 'dagsbudgeten';
  return `${prefix}${verb} ${what} för ${q(p.object_name)} från ${sek(before)} till ${sek(after)}.`;
}

export function confirmationText(p) {
  if (p.type === 'ad_status') {
    return p.proposed_value.status === 'PAUSED' ? `Annonsen ${q(p.object_name)} pausas.` : `Annonsen ${q(p.object_name)} startar igen.`;
  }
  const before = monthlyFromDailyCents(sumBudgets(p.current_value)).toLocaleString('sv-SE');
  const after = monthlyFromDailyCents(sumBudgets(p.proposed_value)).toLocaleString('sv-SE');
  return `Din budget går från ${before} till ${after} kr/mån.`;
}

export const PUBLIC_STATUS = {
  pending: 'Väntar på godkännande',
  approved: 'Godkänd',
  rejected: 'Avstådd',
  expired: 'Gick ut',
  verifying: 'Verifierar',
  done: 'Genomförd',
  failed: 'Misslyckades',
  superseded: 'Ersatt',
};
