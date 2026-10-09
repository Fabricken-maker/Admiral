// Agent 4, del 2 — Godkännandeflödet (Modul D).
//
// Larmar för:
//  - godkännanden som fastnat (godkända men aldrig genomförda inom 15 minuter)
//  - skrivningar som inte verifierats (status Verifierar i mer än en timme)
//  - skrivningar i meta_write_log utan ett använt, registrerat godkännande för just den åtgärden
//  - ändringar som Admirals Meta-app gjort i kundens konto (Metas aktivitetslogg) men som saknas
//    i meta_write_log, alltså ändringar utan godkännande
// Inga reparationer: skrivningar mot Meta görs aldrig om av hälsokollen.
import { pass, fail } from '../lib/result.js';

const A = 'jobs';
const STUCK_MINUTES = 15;
const UNVERIFIED_MINUTES = 60;
const ACTIVITY_DAYS = 8;
const MATCH_WINDOW_MS = 15 * 60000;

export async function checkApprovals(ctx) {
  const { supabase } = ctx;
  let customers;
  try {
    customers = await supabase.select('write_settings', 'select=user_id,writes_enabled,kill_switch,ad_account_ids,users!write_settings_user_id_fkey!inner(email,company_name)');
  } catch (e) {
    return [fail(A, 'jobs.godkännanden', `Kunde inte läsa write_settings: ${e.message}`, { where: 'Supabase write_settings' })];
  }
  ctx.metrics.writes = {
    customers: customers.length,
    writes_enabled: customers.filter((c) => c.writes_enabled).length,
    kill_switch_on: customers.filter((c) => c.kill_switch).map((c) => c.users.company_name || c.users.email),
  };
  if (!customers.length) return [];
  return [
    await checkStuck(ctx),
    await checkUnverified(ctx),
    await checkIntegrity(ctx),
    ...(await checkActivities(ctx, customers)),
  ];
}

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

async function checkStuck(ctx) {
  const id = 'jobs.godkännanden som fastnat';
  const recheck = async () => {
    const rows = await ctx.supabase.select('approvals', `select=id,proposal_id,decided_at,proposals!inner(status,object_name,user_id)&decision=eq.approve&consumed_at=is.null&decided_at=lt.${ago(STUCK_MINUTES)}&proposals.status=eq.approved`);
    return rows.length
      ? { ok: false, cause: `${rows.length} godkännande(n) har inte genomförts på mer än ${STUCK_MINUTES} minuter: ${rows.slice(0, 3).map((r) => `åtgärd ${r.proposal_id} "${r.proposals.object_name}"`).join(', ')}`, rows }
      : { ok: true };
  };
  const r = await recheck();
  return r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/proposals.js → lib/meta-write.js (approvals.consumed_at)', recheck });
}

async function checkUnverified(ctx) {
  const id = 'jobs.skrivningar som inte verifierats';
  const recheck = async () => {
    const rows = await ctx.supabase.select('meta_write_log', `select=id,object_id,created_at&status=eq.verifying&created_at=lt.${ago(UNVERIFIED_MINUTES)}`);
    return rows.length
      ? { ok: false, cause: `${rows.length} skrivning(ar) mot Meta har inte verifierats på mer än en timme: ${rows.slice(0, 3).map((r) => `logg ${r.id} (objekt ${r.object_id})`).join(', ')}` }
      : { ok: true };
  };
  const r = await recheck();
  return r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'meta_write_log (proposals-maintenance läser tillbaka var 15:e minut)', recheck });
}

async function checkIntegrity(ctx) {
  const id = 'jobs.skrivning utan godkännande';
  const rows = await ctx.supabase.select('meta_write_log', `select=id,proposal_id,object_id,approvals!inner(id,proposal_id,decision,consumed_at)&created_at=gte.${ago(30 * 24 * 60)}`);
  const bad = rows.filter((w) => w.approvals.decision !== 'approve' || !w.approvals.consumed_at || w.approvals.proposal_id !== w.proposal_id);
  return bad.length
    ? fail(A, id, `${bad.length} skrivning(ar) mot Meta saknar ett använt godkännande för samma åtgärd: ${bad.slice(0, 3).map((w) => `logg ${w.id}`).join(', ')}`, { where: 'meta_write_log / approvals' })
    : pass(A, id, { checked: rows.length });
}

// Ändringar gjorda av Admirals app som inte har en loggad skrivning för samma objekt inom ±15 min.
export function unmatchedActivities(acts, logs, appId) {
  return acts
    .filter((a) => String(a.application_id || '') === String(appId))
    .filter((a) => !logs.some((l) => {
      const objects = new Set([String(l.object_id), ...Object.keys(l.request || {})]);
      return objects.has(String(a.object_id)) && Math.abs(new Date(a.event_time) - new Date(l.created_at)) <= MATCH_WINDOW_MS;
    }));
}

// Metas aktivitetslogg: varje ändring gjord av Admirals app ska finnas i meta_write_log.
async function checkActivities(ctx, customers) {
  const { meta, config, supabase } = ctx;
  const out = [];
  const appId = String(config.meta.appId || '');
  const admin = await ctx.getAdminUser();
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86400000);
  for (const c of customers) {
    const label = c.users.company_name || c.users.email;
    const token = (await ctx.getValidMetaToken(c.user_id)) || (admin ? await ctx.getValidMetaToken(admin.id) : null);
    for (const acc of c.ad_account_ids || []) {
      const id = `jobs.meta-ändringar utan godkännande ${label} ${acc}`;
      if (!token) { out.push(fail(A, id, `Inget giltigt Meta-token — aktivitetsloggen för ${acc} kunde inte läsas`, { where: `meta_tokens user_id ${c.user_id}` })); continue; }
      let acts;
      try {
        acts = await meta.getAll(`${acc}/activities`, { fields: 'event_type,event_time,application_id,object_id,object_name', since: Math.floor(since / 1000) }, token, 5);
      } catch (e) {
        out.push(fail(A, id, `Metas aktivitetslogg för ${acc} kunde inte läsas: ${e.message}`, { where: `Meta ${acc}/activities` }));
        continue;
      }
      const mine = acts.filter((a) => String(a.application_id || '') === appId);
      const logs = await supabase.select('meta_write_log', `select=id,object_id,request,created_at&ad_account_id=eq.${acc}&created_at=gte.${new Date(since - MATCH_WINDOW_MS).toISOString()}`);
      const unmatched = unmatchedActivities(acts, logs, appId);
      out.push(unmatched.length
        ? fail(A, id, `${unmatched.length} ändring(ar) gjorda av Admirals app i ${acc} saknar registrerat godkännande: ${unmatched.slice(0, 3).map((a) => `${a.event_type} ${a.object_name || a.object_id} ${String(a.event_time).slice(0, 16)}`).join(', ')}`, {
          where: `Meta ${acc}/activities ↔ meta_write_log`,
          deviations: unmatched.slice(0, 20).map((a) => ({ customer: label, account: acc, campaign: a.object_name || a.object_id, metric: a.event_type, admiral: 'saknas i meta_write_log', source: a.event_time, diff: null })),
        })
        : pass(A, id, { admiral_changes: mine.length }));
    }
  }
  return out;
}
