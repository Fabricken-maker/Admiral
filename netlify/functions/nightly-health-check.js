/**
 * Admiral Nightly Health Check — körs 07:00 UTC dagligen
 * Kontrollerar token, pacing och budget per kund
 * Skickar daglig rapport till admin + token-varningar till kunder
 */
import { createClient } from '@supabase/supabase-js';
import { sendEmail, buildAdminDailyReport } from './lib/send-email.js';
import { healthFinding, sendTokenNotice } from './lib/token-notice.js';
import { fireWebhook } from './lib/fire-webhooks.js';
import { readToken } from './lib/token-store.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hej@admiralai.se';

const handler = async () => {
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

      // Webhook: account.inactive vid 30+ dagar
      if (severity === 'warning') {
        await fireWebhook('account.inactive', {
          user_id: u.id, email: u.email,
          days_inactive: daysInactive,
          last_login_at: u.last_login_at
        }).catch(() => {});
      }
    }
  } catch (e) { /* silent */ }

  // Hämta alla användare med kopplat Meta-token
  const { data: tokenUsers } = await supabase
    .from('meta_tokens')
    .select('user_id');
  const tokens = [];
  for (const t of tokenUsers || []) {
    const row = await readToken(supabase, t.user_id).catch(() => null);
    if (row) tokens.push({ user_id: t.user_id, access_token: row.access_token, expires_at: row.expires_at });
  }

  for (const userToken of (tokens || [])) {
    const userId = userToken.user_id;
    const findings = [];

    // ── 1. Kontrollera tokenets giltighetstid ─────────────────
    try {
      if (userToken.expires_at) {
        findings.push({ category: 'token', ...healthFinding(userToken.expires_at) });
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

    // ── Mejla kunden en gång per läge (7 dagar kvar, 3 dagar kvar, utgånget) ──
    if (userToken.expires_at) {
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('id, email, company_name')
          .eq('id', userId)
          .single();

        const notice = await sendTokenNotice({ supabase, sendEmail, user: userRow, expiresAt: userToken.expires_at });
        if (notice.sent) {
          const daysLeft = findings.find(f => f.category === 'token')?.details?.days_left;
          await fireWebhook(notice.state === 'utgatt' ? 'token.expired' : 'token.expiring', {
            user_id: userId, email: userRow.email, company_name: userRow.company_name,
            days_left: daysLeft, state: notice.state
          }).catch(() => {});
        } else if (notice.error) {
          console.error(`[nightly-health-check] Mejl om Meta-kopplingen till användare ${userId} misslyckades: ${notice.error}`);
        }
      } catch (e) {
        console.error(`[nightly-health-check] Mejl om Meta-kopplingen: ${e.message}`);
      }
    }

    // ── Webhook: budget-avvikelse ───────────────────────────────
    const pacingFindings = findings.filter(f => f.category === 'pacing' && f.severity === 'warning');
    for (const pf of pacingFindings) {
      await fireWebhook('budget.deviation', {
        user_id: userId, message: pf.message, details: pf.details
      }).catch(() => {});
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

export default modern(handler);
