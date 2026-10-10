// Agent 4 — Flöden & jobb.
// Schemalagda jobb har körts och producerat färsk data senaste perioden:
//  - nightly-health-check (07:00 UTC) → health_reports varje dygn
//  - budget-adjust (06:00 UTC) → spend_log per aktiv plan och dygn, inga meta_api-fel
//  - GA4-synk → /api/ga4/insights levererar data
//  - ChromaDB (Sofias minne på VPS:en) → svarar och växer
//  - weekly-sync (05:15 UTC) → weekly_metrics har senaste avslutade vecka, inga synkfel
//  - godkännandeflödet (Modul D) → inga godkännanden som fastnat, inga overifierade skrivningar,
//    inga ändringar i Meta utan godkännande (se jobs-approvals.js)
// budget-adjust och nightly-health-check startas aldrig om av modulen:
// budget-adjust ändrar budgetar i Meta och nightly-health-check skickar mejl/webhooks.
// Tillåten reparation: omstart av ChromaDB-containern om den inte svarar.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pass, fail, skip } from '../lib/result.js';
import { fetchJson } from '../lib/http.js';
import { addDays, completedWeekStarts, stockholmMidnight } from '../lib/time.js';
import { checkApprovals } from './jobs-approvals.js';
import { exposedOn } from '../lib/exposure.js';
import { checkTokenNotices } from './jobs-notices.js';
import { checkReviews } from './jobs-reviews.js';
import { checkFatigue } from './jobs-fatigue.js';

const A = 'jobs';
const run$ = promisify(execFile);

const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);
// Dygn (UTC) som ett dagligt jobb schemalagt kl hourUtc borde ha hunnit köra.
export function expectedRunDays(hourUtc, days = 7, now = new Date()) {
  const today = utcDate(now);
  const ranToday = now.getUTCHours() * 60 + now.getUTCMinutes() >= hourUtc * 60 + 30;
  const last = ranToday ? today : addDays(today, -1);
  return Array.from({ length: days }, (_, i) => addDays(last, -i)).reverse();
}

export async function run(ctx) {
  const results = await Promise.all([
    checkNightly(ctx),
    checkBudgetAdjust(ctx),
    checkGa4(ctx),
    checkChroma(ctx),
    checkWeeklySync(ctx),
    checkApprovals(ctx),
    checkTokenNotices(ctx),
    checkReviews(ctx),
    checkFatigue(ctx),
  ]);
  return results.flat();
}

async function checkNightly(ctx) {
  const id = 'jobs.nightly-health-check';
  const days = expectedRunDays(7);
  const recheck = async () => {
    const rows = await ctx.supabase.select('health_reports', `select=report_date&report_date=gte.${days[0]}&category=neq.meta_api`);
    const have = new Set(rows.map((r) => r.report_date));
    const missing = days.filter((d) => !have.has(d));
    return missing.length ? { ok: false, cause: `nightly-health-check har inte skrivit health_reports för ${missing.join(', ')}` } : { ok: true };
  };
  const r = await recheck();
  return r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/nightly-health-check.js (schema 0 7 * * *)', recheck });
}

async function checkBudgetAdjust(ctx) {
  const { supabase } = ctx;
  const out = [];
  const days = expectedRunDays(6);
  const plans = await supabase.select('budget_plans', `select=id,campaign_name,month_start,month_end&status=eq.active&month_start=lte.${days.at(-1)}&month_end=gte.${days[0]}`);
  for (const plan of plans) {
    const id = `jobs.budget-adjust plan ${plan.id}`;
    const due = days.filter((d) => d >= plan.month_start && d <= plan.month_end);
    const recheck = async () => {
      const rows = await supabase.select('spend_log', `select=log_date&budget_plan_id=eq.${plan.id}&log_date=gte.${due[0]}`);
      const have = new Set(rows.map((r) => r.log_date));
      const missing = due.filter((d) => !have.has(d));
      return missing.length ? { ok: false, cause: `budget-adjust har inte loggat spend för "${plan.campaign_name}" ${missing.join(', ')}` } : { ok: true };
    };
    if (!due.length) continue;
    const r = await recheck();
    out.push(r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/budget-adjust.js (schema 0 6 * * *)', recheck }));
  }
  {
    const id = 'jobs.budget-adjust meta_api-fel';
    const errs = await supabase.select('health_reports', `select=report_date,message&category=eq.meta_api&severity=eq.critical&report_date=gte.${days[0]}&order=report_date.desc`);
    out.push(errs.length
      ? fail(A, id, `budget-adjust misslyckades mot Meta ${errs.length} gång(er) senaste 7 dygnen, senast ${errs[0].report_date}: ${errs[0].message}`, { where: 'netlify/functions/budget-adjust.js' })
      : pass(A, id));
  }
  return out;
}

// Senaste vecka som weekly-sync borde ha hämtat: avslutad vecka vars slut ligger
// minst 30 h bakåt (synken körs dagligen 05:15 UTC).
export function expectedSyncedWeek(now = new Date()) {
  const [last] = completedWeekStarts(1, now);
  const ready = stockholmMidnight(addDays(last, 7)).getTime() + 30 * 3600_000;
  return now.getTime() >= ready ? last : addDays(last, -7);
}

async function checkWeeklySync(ctx) {
  const { supabase } = ctx;
  const out = [];
  const customers = await supabase.select('weekly_settings', 'select=user_id,ad_account_ids,users!inner(email,company_name)&active=eq.true');
  if (!customers.length) return out;
  const expected = expectedSyncedWeek();
  for (const c of customers) {
    const label = c.users.company_name || c.users.email;
    for (const acc of c.ad_account_ids || []) {
      const id = `jobs.weekly-sync ${label} ${acc}`;
      const recheck = async () => {
        const [row] = await supabase.select('weekly_metrics', `select=week_start&user_id=eq.${c.user_id}&ad_account_id=eq.${acc}&campaign_id=eq._konto&order=week_start.desc&limit=1`);
        if (!row) return { ok: false, cause: `weekly-sync har aldrig hämtat veckodata för ${label} (${acc})` };
        return row.week_start >= expected ? { ok: true } : { ok: false, cause: `weekly-sync har inte hämtat vecka ${expected} för ${label} (${acc}); senaste är ${row.week_start}` };
      };
      const r = await recheck();
      out.push(r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/weekly-sync.js (schema 15 5 * * *)', recheck }));
    }
  }
  {
    const id = 'jobs.weekly-sync fel';
    const since = addDays(new Date().toISOString().slice(0, 10), -6);
    const errs = await supabase.select('health_reports', `select=report_date,message,details&category=eq.weekly_sync&report_date=gte.${since}&order=report_date.desc`);
    out.push(errs.length
      ? fail(A, id, `Veckosynken misslyckades ${errs.length} gång(er) senaste 7 dygnen, senast ${errs[0].report_date}: ${errs[0].message}${errs[0].details?.error ? ` (${errs[0].details.error})` : ''}`, { where: 'netlify/functions/weekly-sync.js' })
      : pass(A, id));
  }
  return out;
}

async function checkGa4(ctx) {
  const admin = await ctx.getAdminUser();
  if (!admin) return [];
  const id = 'jobs.ga4';
  // Utan budget_plan_id: endpointen skriver då inget till ga4_metrics.
  const recheck = async () => {
    const r = await ctx.admiral.api('/api/ga4/insights?days=7', { token: ctx.admiral.tokenFor(admin) });
    if (r.status !== 200) return { ok: false, cause: `GA4-synken svarade HTTP ${r.status || r.error}${r.json?.error ? `: ${r.json.error}` : ''}` };
    if (r.json?.not_configured) return { ok: false, cause: 'GA4 är inte konfigurerat i Admiral (GA4_PROPERTY_ID/GA4_SERVICE_ACCOUNT_JSON)' };
    if (!r.json?.daily?.length) return { ok: false, cause: 'GA4 returnerade ingen data för senaste 7 dygnen' };
    return { ok: true };
  };
  const r = await recheck();
  return r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/ga4-insights.js', recheck });
}

async function checkChroma(ctx) {
  const { config, supabase } = ctx;
  if (!config.chroma.url) return skip(A, 'jobs.chromadb', 'CHROMA_URL saknas i modulens konfiguration');
  const base = config.chroma.url.replace(/\/$/, '');
  const heartbeat = async () => {
    const r = await fetchJson(`${base}/api/v2/heartbeat`, { timeoutMs: 10_000 });
    return r.ok ? { ok: true } : { ok: false, cause: `ChromaDB svarar inte (${r.status ? `HTTP ${r.status}` : r.error})` };
  };

  const out = [];
  const hb = await heartbeat();
  if (!hb.ok) {
    const result = fail(A, 'jobs.chromadb svarar', hb.cause, { where: `ChromaDB ${base}`, recheck: heartbeat });
    if (config.chroma.container) {
      result.action = await restartChroma(ctx, heartbeat);
      result.human = !result.action.ok;
    }
    out.push(result);
    return out;
  }
  out.push(pass(A, 'jobs.chromadb svarar'));

  // ChromaDB har ingen inloggning: den får bara nås från servern själv (127.0.0.1).
  const port = Number(new URL(base).port || 80);
  const open = await exposedOn(port);
  out.push(open.length
    ? fail(A, 'jobs.chromadb stängd utåt', `ChromaDB nås utan inloggning på serverns publika adress ${open.map((a) => `${a}:${port}`).join(', ')}`, { where: '/docker/openclaw-b7n2/docker-compose.yml (ports för chroma ska vara 127.0.0.1:8000:8000)' })
    : pass(A, 'jobs.chromadb stängd utåt'));

  // Färskhet: antal poster ska ha ökat sedan körningen för minst 6 dagar sedan.
  const col = `${base}/api/v2/tenants/default_tenant/databases/default_database/collections`;
  const list = await fetchJson(col, { timeoutMs: 10_000 });
  if (!list.ok) return [...out, fail(A, 'jobs.chromadb samlingar', `Kunde inte lista ChromaDB-samlingar (HTTP ${list.status || list.error})`, { where: `ChromaDB ${base}` })];
  let total = 0;
  for (const c of list.json || []) {
    const n = await fetchJson(`${col}/${c.id}/count`, { timeoutMs: 10_000 });
    total += Number(n.json) || 0;
  }
  ctx.metrics.chroma_total = total;
  const cutoff = new Date(Date.now() - 6 * 86400000).toISOString();
  const [prev] = await supabase.select('admiral_healthchecks', `select=started_at,metrics&metrics->>chroma_total=not.is.null&started_at=lte.${cutoff}&order=started_at.desc&limit=1`).catch(() => []);
  const id = 'jobs.chromadb färsk data';
  if (!prev) out.push(pass(A, id, { baseline: true }));
  else {
    const before = Number(prev.metrics.chroma_total);
    if (total < before) out.push(fail(A, id, `ChromaDB har ${total} poster, ${before - total} färre än ${prev.started_at.slice(0, 10)}`, { where: `ChromaDB ${base}` }));
    else if (total === before) out.push(fail(A, id, `ChromaDB har inte fått några nya poster sedan ${prev.started_at.slice(0, 10)} (${total} poster)`, { where: `ChromaDB ${base} (Sofias minne)` }));
    else out.push(pass(A, id));
  }
  return out;
}

async function restartChroma(ctx, heartbeat) {
  const name = ctx.config.chroma.container;
  const action = { kind: 'restart', description: `Startade om containern ${name}` };
  if (ctx.dryRun) return { ...action, ok: false, skipped: 'torrkörning' };
  try {
    const { stdout } = await run$('docker', ['inspect', '-f', '{{.State.Status}}', name], { timeout: 15_000 });
    action.before = { status: stdout.trim() };
    await run$('docker', ['restart', name], { timeout: 60_000 });
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if ((await heartbeat()).ok) return { ...action, ok: true, after: { status: 'running' } };
    }
    return { ...action, ok: false, error: 'ChromaDB svarar inte efter omstart' };
  } catch (e) {
    return { ...action, ok: false, error: e.message };
  }
}
