/**
 * Admiral Nightly Health Check — körs 07:00 UTC dagligen
 * Kontrollerar token, pacing, budget-adjust och spend-anomalier
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async () => {
  const token = process.env.META_ACCESS_TOKEN;
  const today = new Date().toISOString().split('T')[0];
  const findings = [];

  // ── 1. Kontrollera Meta-tokenets giltighetstid ─────────────
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/debug_token?input_token=${token}&access_token=${token}`
    );
    const data = await res.json();
    const exp = data.data?.expires_at;
    if (exp) {
      const daysLeft = Math.ceil((exp * 1000 - Date.now()) / 86400000);
      if (daysLeft <= 3) {
        findings.push({ severity: 'critical', category: 'token', message: `Meta-token löper ut om ${daysLeft} dag(ar) — förnya omedelbart`, details: { expires_at: new Date(exp * 1000).toISOString(), days_left: daysLeft } });
      } else if (daysLeft <= 7) {
        findings.push({ severity: 'warning', category: 'token', message: `Meta-token löper ut om ${daysLeft} dagar — planera förnyelse`, details: { expires_at: new Date(exp * 1000).toISOString(), days_left: daysLeft } });
      } else {
        findings.push({ severity: 'info', category: 'token', message: `Meta-token är giltigt i ${daysLeft} dagar`, details: { days_left: daysLeft } });
      }
    }
  } catch (e) {
    findings.push({ severity: 'critical', category: 'token', message: `Kunde inte verifiera Meta-token: ${e.message}` });
  }

  // ── 2. Kontrollera att budget-adjust körde idag ────────────
  try {
    const { data: logs } = await supabase
      .from('spend_log')
      .select('id')
      .eq('log_date', today)
      .limit(1);

    if (!logs?.length) {
      findings.push({ severity: 'warning', category: 'budget', message: 'Budget-adjust verkar inte ha kört idag — inga spend-loggar för ' + today });
    } else {
      findings.push({ severity: 'info', category: 'budget', message: 'Budget-adjust körde korrekt idag' });
    }
  } catch (e) {
    findings.push({ severity: 'critical', category: 'budget', message: `Kunde inte kontrollera spend-loggar: ${e.message}` });
  }

  // ── 3. Kontrollera pacing per aktiv budgetplan ─────────────
  try {
    const { data: plans } = await supabase
      .from('budget_plans')
      .select('id, campaign_name, monthly_budget')
      .eq('status', 'active');

    for (const plan of (plans || [])) {
      const { data: log } = await supabase
        .from('spend_log')
        .select('pacing_ratio, actual_spend, planned_spend')
        .eq('budget_plan_id', plan.id)
        .eq('log_date', today)
        .single();

      if (!log) continue;

      const ratio = parseFloat(log.pacing_ratio || 0);
      if (ratio > 1.35) {
        findings.push({ severity: 'warning', category: 'pacing', message: `${plan.campaign_name}: spenderar för snabbt (${(ratio * 100).toFixed(0)}% av planerat)`, details: { plan_id: plan.id, pacing_ratio: ratio, actual: log.actual_spend, planned: log.planned_spend } });
      } else if (ratio < 0.65 && ratio > 0) {
        findings.push({ severity: 'warning', category: 'pacing', message: `${plan.campaign_name}: spenderar för långsamt (${(ratio * 100).toFixed(0)}% av planerat)`, details: { plan_id: plan.id, pacing_ratio: ratio, actual: log.actual_spend, planned: log.planned_spend } });
      } else if (ratio === 0) {
        findings.push({ severity: 'critical', category: 'pacing', message: `${plan.campaign_name}: 0 kr i spend trots aktiv budget — kontrollera kampanjen i Meta`, details: { plan_id: plan.id } });
      } else {
        findings.push({ severity: 'info', category: 'pacing', message: `${plan.campaign_name}: pacing OK (${(ratio * 100).toFixed(0)}%)`, details: { pacing_ratio: ratio } });
      }
    }
  } catch (e) {
    findings.push({ severity: 'critical', category: 'pacing', message: `Kunde inte kontrollera pacing: ${e.message}` });
  }

  // ── Spara alla findings i Supabase ─────────────────────────
  if (findings.length) {
    await supabase.from('health_reports').insert(
      findings.map(f => ({ report_date: today, ...f }))
    );
  }

  const criticals = findings.filter(f => f.severity === 'critical').length;
  const warnings  = findings.filter(f => f.severity === 'warning').length;

  return {
    statusCode: 200,
    body: JSON.stringify({ date: today, findings: findings.length, criticals, warnings, results: findings })
  };
};
