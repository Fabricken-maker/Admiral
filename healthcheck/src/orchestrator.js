// Orkestrator: startar agent 1–4 parallellt (egen tidsgräns per agent), låter
// verifieraren köra om allt som felade, bestämmer status, sparar körningen i
// admiral_healthchecks och skickar sammanfattningen.
import crypto from 'node:crypto';
import { installGuard } from './lib/guard.js';
import { withTimeout } from './lib/http.js';
import { createSupabase } from './lib/supabase.js';
import { createMetaClient } from './lib/meta.js';
import { createAdmiral } from './lib/admiral.js';
import { sendTelegram } from './lib/telegram.js';
import { isoWeekKey } from './lib/time.js';
import { buildReport, decideStatus } from './report.js';
import * as infra from './agents/infra.js';
import * as data from './agents/data.js';
import * as ui from './agents/ui.js';
import * as jobs from './agents/jobs.js';
import * as verifier from './agents/verifier.js';

export const AGENTS = { infra, data, ui, jobs };

export function createContext(config, { trigger = 'manual', dryRun = false, options = {}, only = null } = {}) {
  installGuard({ baseUrl: config.baseUrl, supabaseUrl: config.supabaseUrl });
  const supabase = createSupabase({ url: config.supabaseUrl, key: config.supabaseKey, timeoutMs: config.timeouts.httpMs });
  const meta = createMetaClient({ ...config.meta, timeoutMs: config.timeouts.httpMs });
  const admiral = createAdmiral({ baseUrl: config.baseUrl, jwtSecret: config.jwtSecret, timeoutMs: config.timeouts.httpMs });

  // Delade läsningar (cache per körning). Agenterna skriver aldrig via dessa.
  let adminUser;
  const tokenCache = new Map();
  const ctx = {
    runId: crypto.randomUUID(),
    trigger, dryRun, options, only, config, supabase, meta, admiral,
    metrics: {},
    async getAdminUser() {
      if (adminUser === undefined) {
        const rows = await supabase.select('users', `select=id,email&email=eq.${encodeURIComponent(config.adminEmail)}`);
        adminUser = rows[0] || null;
      }
      return adminUser;
    },
    // Giltigt Meta-token för en användare, annars null (validerat mot debug_token).
    async getValidMetaToken(userId) {
      if (!tokenCache.has(userId)) {
        tokenCache.set(userId, (async () => {
          const [row] = await supabase.rpc('meta_token_get', { p_user_id: userId });
          if (!row) return null;
          const d = await meta.debugToken(row.access_token).catch(() => ({}));
          return d.is_valid && (d.scopes || []).includes('ads_read') ? row.access_token : null;
        })());
      }
      return tokenCache.get(userId);
    },
  };
  return ctx;
}

export async function runHealthcheck(config, opts = {}) {
  const ctx = createContext(config, opts);
  const startedAt = new Date();
  const weekKey = isoWeekKey(startedAt);
  const runKey = ctx.trigger === 'scheduled' ? `weekly-${weekKey}` : `${ctx.trigger}-${startedAt.toISOString()}`;

  // Idempotens: en schemalagd körning per vecka. Dubbel cron-start gör ingenting.
  if (ctx.trigger === 'scheduled' && !opts.force) {
    const done = await ctx.supabase.select('admiral_healthchecks', `select=id,status&run_key=eq.${runKey}&limit=1`);
    if (done.length) return { skipped: true, runKey, status: done[0].status };
  }

  // ── Agent 1–4 parallellt ──
  const selected = Object.entries(AGENTS).filter(([name]) => !ctx.only || ctx.only.includes(name));
  const settled = await Promise.allSettled(selected.map(([name, agent]) =>
    withTimeout(agent.run(ctx), config.timeouts.agentMs, `agent ${name}`)));

  const results = [];
  settled.forEach((s, i) => {
    const name = selected[i][0];
    if (s.status === 'fulfilled') results.push(...s.value.map((r) => ({ ...r, agent: r.agent || name })));
    else results.push({ agent: name, id: `${name}.agent`, ok: false, human: true, cause: `Agenten ${name} kraschade: ${s.reason?.message || s.reason}`, where: `healthcheck/src/agents/${name}.js` });
  });

  // ── Agent 5: verifierare ──
  const failed = results.filter((r) => !r.ok);
  const verdicts = failed.length ? await verifier.run(ctx, failed) : new Map();
  const issues = failed.map((r) => {
    const v = verdicts.get(r.id) || {};
    return { ...r, verified: v.verified ?? null, verifyCause: v.cause ?? null };
  });

  const skippedList = results.filter((r) => r.skipped);
  const totals = {
    checks: results.length,
    ok: results.filter((r) => r.ok && !r.skipped).length,
    skipped: skippedList.length,
    skippedList,
  };
  const status = decideStatus(issues);
  const report = buildReport({ status, startedAt, weekKey, trigger: ctx.trigger, dryRun: ctx.dryRun, totals, issues });
  const finishedAt = new Date();

  const row = {
    run_id: ctx.runId,
    run_key: runKey,
    trigger: ctx.trigger,
    dry_run: ctx.dryRun,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt - startedAt,
    status,
    checks_total: totals.checks,
    checks_ok: totals.ok,
    deviations: issues.map(serializeIssue),
    actions: issues.filter((i) => i.action).map((i) => ({ check: i.id, verified: i.verified, ...i.action })),
    metrics: { ...ctx.metrics, per_agent: Object.fromEntries(selected.map(([n]) => [n, results.filter((r) => r.agent === n).length])) },
    report_text: report,
    module_version: config.version,
  };

  let persisted = { ok: true };
  if (!opts.noPersist) {
    try { await ctx.supabase.insert('admiral_healthchecks', [row]); } catch (e) { persisted = { ok: false, error: e.message }; }
  }
  let notified = { ok: false, error: 'avstängt' };
  if (!opts.noNotify) notified = await sendTelegram(config.telegram, report);

  return { status, report, row, issues, results, persisted, notified };
}

function serializeIssue(i) {
  return {
    check: i.id, agent: i.agent, cause: i.cause, where: i.where ?? null,
    human: !!i.human || i.verified !== true, verified: i.verified,
    deviations: i.deviations ?? [], verify_cause: i.verifyCause,
  };
}
