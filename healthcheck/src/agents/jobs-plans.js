// Agent 4, del 6 — Kampanjupptäckten (campaign-discovery, schema 15 4 * * * UTC).
//
// En kampanj som haft spend senaste avslutade veckan ska ha en AKTIV budgetplan.
// Utan plan härleds inga konton i meta-campaigns/meta-accounts och kampanjen är
// osynlig för kunden i dashboarden, trots att pengarna rullar i Meta.
// Spend läses ur weekly_metrics (synkad från Meta) — inga egna Meta-anrop här.
// Ingen reparation: planer skapas bara av campaign-discovery.
import { pass, fail } from '../lib/result.js';
import { addDays } from '../lib/time.js';

const A = 'jobs';
const WHERE = 'netlify/functions/campaign-discovery.js (schema 15 4 * * *)';

// Kampanjer med spend som saknar aktiv plan. Ren logik för tester.
export function plansMissing({ metrics, plans }) {
  const status = new Map();
  for (const p of plans) {
    const prev = status.get(p.campaign_id);
    if (!prev || prev === 'completed' || p.status === 'active') status.set(p.campaign_id, p.status);
  }
  return metrics
    .filter((m) => Number(m.spend) > 0)
    .map((m) => ({ ...m, plan_status: status.get(m.campaign_id) || null }))
    .filter((m) => m.plan_status !== 'active');
}

export async function checkPlanCoverage(ctx, week) {
  const { supabase } = ctx;
  const out = [];
  const customers = await supabase.select('weekly_settings', 'select=user_id,ad_account_ids,users!inner(email,company_name,status)&active=eq.true');
  for (const c of customers) {
    if (c.users.status !== 'active') continue;
    const label = c.users.company_name || c.users.email;
    for (const acc of c.ad_account_ids || []) {
      const recheck = async () => {
        const [metrics, plans] = await Promise.all([
          supabase.select('weekly_metrics', `select=campaign_id,campaign_name,spend&user_id=eq.${c.user_id}&ad_account_id=eq.${acc}&week_start=eq.${week}&campaign_id=neq._konto`),
          supabase.select('budget_plans', `select=campaign_id,status&user_id=eq.${c.user_id}&ad_account_id=eq.${acc}`),
        ]);
        const missing = plansMissing({ metrics, plans });
        if (!missing.length) return { ok: true };
        const list = missing.map((m) => `"${m.campaign_name || m.campaign_id}" (${Math.round(m.spend)} kr${m.plan_status ? `, planen är ${m.plan_status}` : ', ingen plan alls'})`);
        return { ok: false, cause: `${label} (${acc}): kampanjer med spend veckan ${week}–${addDays(week, 6)} utan aktiv budgetplan — kunden ser dem inte i dashboarden: ${list.join(', ')}` };
      };
      const id = `jobs.kampanjplan ${label} ${acc}`;
      const r = await recheck();
      out.push(r.ok ? pass(A, id) : fail(A, id, r.cause, { where: WHERE, recheck }));
    }
  }
  return out;
}
