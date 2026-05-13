/**
 * Admiral Nightly Health Check — körs 07:00 UTC dagligen
 * Kontrollerar token, pacing och budget per kund
 * Skickar daglig rapport till admin + token-varningar till kunder
 */
import { createClient } from '@supabase/supabase-js';
import { sendEmail, buildAdminDailyReport, buildTokenExpiryEmail } from './lib/send-email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hej@admiralai.se';

export const handler = async () => {
  const today = new Date().toISOString().split('T')[0];
  const allFindings = [];

  // ── Kontrollera inaktiva konton (admin-rapport) ────────────
  try {
    const cutoff60 = new Date(Date.now() - 60 * 86400000).toISOString();
    const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();

    const { data: inactive } = await supabase
      .from('users')
      .select('id, email, last_login_at, status')
      .eq('status', 'active')
      .or(`last_login_at.lt.${cutoff60},last_login_at.is.null`);

    for (const u of (inactive || [])) {
      const lastLogin = u.last_login_at ? new Date(u.last_login_at) : null;
      const daysInactive = lastLogin ? Math.floor((Date.now() - lastLogin) / 86400000) : null;
      const severity = (!lastLogin || new Date(u.last_login_at) < new Date(cutoff90)) ? 'warning' : 'info';
      await supabase.from('health_reports').insert({
        report_date: today,
        user_id: 3, // admin user
        severity,
        category: 'inactivity',
        message: `${u.email}: inaktiv i ${daysInactive ?? '?'} dagar${severity === 'warning' ? ' — överväg att avsluta kontot' : ''}`,
        details: { user_id: u.id, last_login_at: u.last_login_at }
      });
    }
  } catch (e) { /* silent */ }

  // Hämta alla användare med kopplat Meta-token
  const { data: tokens } = await supabase
    .from('meta_tokens')
    .select('user_id, access_token, expires_at');

  for (const userToken of (tokens || [])) {
    const userId = userToken.user_id;
    const findings = [];

    // ── 1. Kontrollera tokenets giltighetstid ─────────────────
    try {
      const exp = userToken.expires_at ? new Date(userToken.expires_at) : null;
      if (exp) {
        const daysLeft = Math.ceil((exp - Date.now()) / 86400000);
        if (daysLeft <= 3) {
          findings.push({ severity: 'critical', category: 'token', message: `Meta-token löper ut om ${daysLeft} dag(ar) — gå till inställningar och återkoppla Meta`, details: { days_left: daysLeft } });
        } else if (daysLeft <= 7) {
          findings.push({ severity: 'warning', category: 'token', message: `Meta-token löper ut om ${daysLeft} dagar — planera förnyelse`, details: { days_left: daysLeft } });
        } else {
          findings.push({ severity: 'info', category: 'token', message: `Meta-token är giltigt i ${daysLeft} dagar`, details: { days_left: daysLeft } });
        }
      }
    } catch (e) {
      findings.push({ severity: 'critical', category: 'token', message: `Kunde inte verifiera Meta-token: ${e.message}` });
    }

    // ── 2. Kontrollera att budget-adjust körde idag ───────────
    try {
      const { data: plans } = await supabase
        .from('budget_plans')
        .select('id, campaign_name, monthly_budget')
        .eq('status', 'active')
        .eq('user_id', userId);

      if (!plans?.length) {
        findings.push({ severity: 'info', category: 'budget', message: 'Inga aktiva budgetplaner' });
      } else {
        // ── 3. Kontrollera pacing per plan ──────────────────────
        for (const plan of plans) {
          const { data: log } = await supabase
            .from('spend_log')
            .select('pacing_ratio, actual_spend, planned_spend')
            .eq('budget_plan_id', plan.id)
            .eq('log_date', today)
            .single();

          if (!log) {
            findings.push({ severity: 'warning', category: 'budget', message: `${plan.campaign_name}: ingen spend-logg idag — budget-adjust kanske inte körde` });
            continue;
          }

          const ratio = parseFloat(log.pacing_ratio || 0);
          if (ratio === 0) {
            findings.push({ severity: 'critical', category: 'pacing', message: `${plan.campaign_name}: 0 kr i spend trots aktiv budget — kontrollera kampanjen i Meta`, details: { plan_id: plan.id } });
          } else if (ratio > 1.35) {
            findings.push({ severity: 'warning', category: 'pacing', message: `${plan.campaign_name}: spenderar för snabbt (${(ratio * 100).toFixed(0)}% av plan)`, details: { plan_id: plan.id, pacing_ratio: ratio } });
          } else if (ratio < 0.65) {
            findings.push({ severity: 'warning', category: 'pacing', message: `${plan.campaign_name}: spenderar för långsamt (${(ratio * 100).toFixed(0)}% av plan)`, details: { plan_id: plan.id, pacing_ratio: ratio } });
          } else {
            findings.push({ severity: 'info', category: 'pacing', message: `${plan.campaign_name}: pacing OK (${(ratio * 100).toFixed(0)}%)` });
          }
        }
      }
    } catch (e) {
      findings.push({ severity: 'critical', category: 'budget', message: `Kunde inte kontrollera budgetar: ${e.message}` });
    }

    // ── Spara findings för denna användare ─────────────────────
    if (findings.length) {
      await supabase.from('health_reports').insert(
        findings.map(f => ({ report_date: today, user_id: userId, ...f }))
      );
      allFindings.push(...findings.map(f => ({ user_id: userId, ...f })));
    }

    // ── Skicka token-varning till kunden om den löper ut ───────
    const tokenFinding = findings.find(f => f.category === 'token' && (f.severity === 'critical' || f.severity === 'warning'));
    if (tokenFinding) {
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('email, name')
          .eq('id', userId)
          .single();

        if (userRow) {
          const daysLeft = tokenFinding.details?.days_left ?? '?';
          await sendEmail({
            to: userRow.email,
            subject: tokenFinding.severity === 'critical'
              ? `⚠️ Ditt Meta-token löper ut om ${daysLeft} dag${daysLeft !== 1 ? 'ar' : ''} — förnya nu`
              : `🔔 Ditt Meta-token löper ut om ${daysLeft} dagar`,
            html: buildTokenExpiryEmail({ name: userRow.name, daysLeft, severity: tokenFinding.severity })
          });
        }
      } catch (e) { /* silent — mail är inte kritiskt */ }
    }
  }

  const criticals = allFindings.filter(f => f.severity === 'critical').length;
  const warnings  = allFindings.filter(f => f.severity === 'warning').length;

  // ── Skicka daglig sammanfattning till admin ─────────────────
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: criticals > 0
      ? `🔴 Admiral: ${criticals} kritiska problem ${today}`
      : warnings > 0
        ? `🟡 Admiral: ${warnings} varningar ${today}`
        : `✅ Admiral: Allt OK ${today}`,
    html: buildAdminDailyReport({
      date: today,
      findings: allFindings,
      criticals,
      warnings,
      users: tokens?.length || 0
    })
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ date: today, users: tokens?.length || 0, findings: allFindings.length, criticals, warnings })
  };
};
