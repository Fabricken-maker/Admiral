// Agent 2 — Datastämning mot Meta Marketing API (sanningskälla).
//
// Två slags siffror i Admiral:
//  1. Genomströmmade (KPI-kort, kampanjtabell): Admiral hämtar last_30d från Meta vid
//     varje sidladdning. Jämförs mot Meta med samma fönster, hämtat i samma ögonblick.
//     Avvikelser bekräftas med en andra hämtning innan de rapporteras.
//  2. Lagrade (spend_log, budget_plans.total_spent): skrivs av budget-adjust ~06:00 UTC.
//     Jämförs bara för dygn äldre än dataLagDays (Meta justerar retroaktivt 24–72 h).
//     Tillåten reparation: omsynk av raden från Meta (föregående värden sparas).
import { pass, fail } from '../lib/result.js';
import { canonicalInsight, PURCHASE_TYPES, ZERO_INSIGHT } from '../lib/metrics.js';
import { compareMetrics, bracketCheck, round } from '../lib/compare.js';
import { stockholmDate, addDays, monthStart } from '../lib/time.js';
import { checkWeekly } from './data-weekly.js';

const A = 'data';

const ACCOUNT_METRICS = { spend: 'amount', impressions: 'int', clicks: 'int', cpm: 'amount', conversions: 'int' };
const CAMPAIGN_METRICS = {
  spend: 'amount', impressions: 'int', clicks: 'int', conversions: 'int',
  revenue: 'amount', roas: 'amount', link_clicks: 'int', landing_page_views: 'int',
};

export async function run(ctx) {
  const results = [];
  results.push(...await checkPassThrough(ctx));
  results.push(...await checkStored(ctx));
  results.push(...await checkWeekly(ctx));
  return results;
}

// ── 1. Genomströmmade siffror ───────────────────────────────────────────────
async function checkPassThrough(ctx) {
  const { admiral, supabase } = ctx;
  const out = [];
  const admin = await ctx.getAdminUser();
  if (!admin) return [fail(A, 'data.admin', 'Admin-kontot saknas — datajämförelse kunde inte köras', { where: 'Supabase users' })];

  const adminMetaToken = await ctx.getValidMetaToken(admin.id);
  if (!adminMetaToken) {
    return [fail(A, 'data.source', 'Inget giltigt Meta-token för admin — datajämförelse mot Meta kunde inte köras', { where: `meta_tokens user_id ${admin.id}` })];
  }

  // Vyer att jämföra: admin (alla konton) + varje kund med aktiva budgetplaner.
  const views = [{ label: 'admin', user: admin, metaToken: adminMetaToken, allowedAccounts: null }];
  const plans = await supabase.select('budget_plans', 'select=user_id,ad_account_id,users!inner(id,email,company_name,status)&status=eq.active&users.status=eq.active');
  const byUser = new Map();
  for (const p of plans) {
    if (p.user_id === admin.id) continue;
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, { user: p.users, accounts: new Set() });
    byUser.get(p.user_id).accounts.add(p.ad_account_id);
  }
  for (const [userId, { user, accounts }] of byUser) {
    const token = await ctx.getValidMetaToken(userId);
    const label = user.company_name || user.email;
    if (!token) {
      out.push(fail(A, `data.kund ${userId}`, `Kunden ${label} har aktiva budgetplaner men inget giltigt Meta-token — kundens siffror kan inte hämtas`, { where: `meta_tokens user_id ${userId}` }));
      continue;
    }
    views.push({ label, user: { id: userId, email: user.email }, metaToken: token, allowedAccounts: accounts });
  }

  for (const view of views) {
    out.push(...await compareView(ctx, view));
  }
  return out;
}

async function compareView(ctx, view) {
  const { admiral } = ctx;
  const out = [];
  const jwt = admiral.tokenFor(view.user);
  const isAdmin = view.allowedAccounts === null;

  const collect = async () => {
    const [accRes, campRes] = await Promise.all([
      isAdmin ? admiral.api('/api/meta/accounts', { token: jwt }) : Promise.resolve(null),
      admiral.api('/api/meta/campaigns', { token: jwt }),
    ]);
    const source = await fetchMeta(ctx, view);
    return { accRes, campRes, source };
  };

  const first = await collect();
  if (first.campRes.status !== 200 || (first.accRes && first.accRes.status !== 200)) {
    const bad = first.accRes?.status !== 200 ? first.accRes : first.campRes;
    return [fail(A, `data.${view.label}`, `Admirals API svarade HTTP ${bad.status || bad.error} — jämförelse kunde inte göras`, { where: '/api/meta/accounts, /api/meta/campaigns' })];
  }

  let devs = diffView(ctx, view, first);
  if (devs.length) {
    // Bekräfta med ny hämtning; bara avvikelser som består räknas.
    const second = await collect();
    const again = new Set(diffView(ctx, view, second).map(key));
    devs = devs.filter((d) => again.has(key(d)));
  }

  const scopeDevs = isAdmin ? [] : scopeViolations(view, first.campRes.json.campaigns);
  if (scopeDevs.length) {
    out.push(fail(A, `data.scope ${view.label}`, `Kunden ${view.label} ser kampanjer från annonskonton utanför sina budgetplaner`, {
      where: 'netlify/functions/meta-campaigns.js (kontofiltrering)', deviations: scopeDevs,
    }));
  }

  // Gruppera per (konto/kampanj-nivå, mått) så att rapporten blir kort men komplett.
  const groups = new Map();
  for (const d of devs) {
    const g = `${d.level}|${d.metric}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  for (const [g, list] of groups) {
    const [level, metric] = g.split('|');
    const recheck = async () => {
      const c = await collect();
      const still = diffView(ctx, view, c).filter((d) => d.level === level && d.metric === metric);
      return still.length ? { ok: false, cause: `${still.length} avvikelser kvar` } : { ok: true };
    };
    out.push(fail(A, `data.${view.label}.${level}.${metric}`, causeFor(level, metric, list, view), {
      where: whereFor(level, metric, list),
      deviations: list.map(({ level: _l, cause: _c, ...d }) => d),
      recheck,
    }));
  }
  // Täckning sparas i admiral_healthchecks.metrics så att "inga avvikelser" kan skiljas från "inget jämfört".
  const accounts = isAdmin ? first.source.accounts.length : 0;
  const campaigns = first.campRes.json.campaigns.length;
  const values = accounts * Object.keys(ACCOUNT_METRICS).length + campaigns * Object.keys(CAMPAIGN_METRICS).length;
  ctx.metrics.data_compared = { ...(ctx.metrics.data_compared || {}), [view.label]: { accounts, campaigns, values } };
  if (!values) out.push(fail(A, `data.${view.label} täckning`, `Inga siffror kunde jämföras i ${view.label}-vyn (0 konton och 0 kampanjer från Admiral)`, { where: '/api/meta/accounts, /api/meta/campaigns' }));
  else if (!devs.length) out.push(pass(A, `data.${view.label}`, { compared: values }));
  return out;
}

const key = (d) => `${d.level}|${d.account}|${d.campaign}|${d.metric}`;

// Hämtar sanningen från Meta för samma konton och samma fönster som Admiral.
async function fetchMeta(ctx, view) {
  const { meta } = ctx;
  let accounts = await meta.getAll('me/adaccounts', { fields: 'id,name,currency,account_status' }, view.metaToken);
  if (view.allowedAccounts) accounts = accounts.filter((a) => view.allowedAccounts.has(a.id));

  await Promise.all(accounts.map(async (acc) => {
    const [accIns, campIns, camps] = await Promise.all([
      meta.get(`${acc.id}/insights`, { fields: 'spend,impressions,clicks,cpm,actions,action_values', date_preset: 'last_30d' }, view.metaToken),
      meta.getAll(`${acc.id}/insights`, { level: 'campaign', fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values', date_preset: 'last_30d' }, view.metaToken),
      meta.getAll(`${acc.id}/campaigns`, { fields: 'id,name,status' }, view.metaToken),
    ]);
    acc.insight = canonicalInsight(accIns.data?.[0]);
    acc.rawActions = accIns.data?.[0]?.actions || [];
    acc.campaignInsights = new Map(campIns.map((r) => [r.campaign_id, { ...canonicalInsight(r), rawActions: r.actions || [], rawValues: r.action_values || [] }]));
    acc.campaigns = camps.filter((c) => c.status !== 'DELETED' && c.status !== 'ARCHIVED');
  }));
  return { accounts };
}

function applyInjection(ctx, level, entityId, vals) {
  const inj = ctx.options?.inject;
  if (!inj || inj.level !== level || inj.id !== entityId) return vals;
  return { ...vals, [inj.metric]: Number(vals[inj.metric] || 0) * (inj.factor ?? 1) + (inj.delta ?? 0) };
}

export function diffView(ctx, view, { accRes, campRes, source }) {
  const tol = ctx.config.tolerance;
  const devs = [];
  const metaAccounts = new Map(source.accounts.map((a) => [a.id, a]));
  const customer = view.label;

  // Kontonivå (KPI-korten bygger på dessa)
  if (accRes) {
    const admAccounts = new Map((accRes.json.accounts || []).map((a) => [a.id, a]));
    for (const [id, m] of metaAccounts) {
      const adm = admAccounts.get(id);
      if (!adm) {
        devs.push({ level: 'konto', customer, account: `${m.name} (${id})`, campaign: null, metric: 'konto saknas i Admiral', admiral: 0, source: 1, diff: -1 });
        continue;
      }
      const admVals = applyInjection(ctx, 'konto', id, adm);
      for (const d of compareMetrics({ customer, account: `${m.name} (${id})` }, admVals, m.insight, ACCOUNT_METRICS, tol)) {
        devs.push({ level: 'konto', ...d, cause: purchaseCause(d, m.rawActions) });
      }
    }
    for (const [id, adm] of admAccounts) {
      if (!metaAccounts.has(id)) devs.push({ level: 'konto', customer, account: `${adm.name} (${id})`, campaign: null, metric: 'konto finns inte i Meta', admiral: 1, source: 0, diff: 1 });
    }
  }

  // Kampanjnivå (kampanjtabellen)
  const admCamps = campRes.json.campaigns || [];
  const admByAccount = new Map();
  for (const c of admCamps) {
    if (!admByAccount.has(c.ad_account_id)) admByAccount.set(c.ad_account_id, []);
    admByAccount.get(c.ad_account_id).push(c);
  }
  for (const [actId, m] of metaAccounts) {
    const admList = admByAccount.get(actId) || [];
    const account = `${m.name} (${actId})`;
    // Antal kampanjer: Admiral visar alla ej raderade/arkiverade kampanjer per konto.
    if (admList.length !== m.campaigns.length) {
      devs.push({ level: 'kampanj', customer, account, campaign: null, metric: 'antal kampanjer', admiral: admList.length, source: m.campaigns.length, diff: admList.length - m.campaigns.length });
    }
    for (const c of admList) {
      const truth = m.campaignInsights.get(c.id) || ZERO_INSIGHT;
      const admVals = applyInjection(ctx, 'kampanj', c.id, c);
      for (const d of compareMetrics({ customer, account, campaign: `${c.name} (${c.id})` }, admVals, truth, CAMPAIGN_METRICS, tol)) {
        devs.push({ level: 'kampanj', ...d, cause: purchaseCause(d, truth.rawActions, truth.rawValues) });
      }
    }
  }
  return devs;
}

// Om Admirals värde är summan av överlappande köp-typer: säg det exakt.
function purchaseCause(d, actions = [], values = []) {
  const sum = (list) => list.filter((a) => PURCHASE_TYPES.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
  if (d.metric === 'conversions' && Math.round(sum(actions)) === d.admiral && d.admiral !== d.source) return 'summerade köp-typer';
  if (d.metric === 'revenue' && Math.abs(sum(values) - d.admiral) < 0.01 && d.admiral !== d.source) return 'summerade köp-typer';
  return null;
}

function scopeViolations(view, campaigns) {
  return campaigns
    .filter((c) => !view.allowedAccounts.has(c.ad_account_id))
    .map((c) => ({ customer: view.label, account: c.ad_account_id, campaign: `${c.name} (${c.id})`, metric: 'åtkomst', admiral: 'synlig', source: 'ej kundens konto', diff: null }));
}

const METRIC_SV = {
  spend: 'spend', impressions: 'visningar', clicks: 'klick', cpm: 'CPM', conversions: 'konverteringar',
  revenue: 'intäkt', roas: 'ROAS', link_clicks: 'länkklick', landing_page_views: 'landningssidvisningar',
};

function causeFor(level, metric, list, view) {
  const n = list.length;
  const what = METRIC_SV[metric] || metric;
  if (metric === 'antal kampanjer') return `Admiral visar ett annat antal kampanjer än Meta på ${n} konto(n) (${view.label}-vyn)`;
  if (metric.startsWith('konto ')) return `Kontolistan i Admiral skiljer sig från Meta: ${n} konto(n) — ${metric}`;
  const doubled = list.filter((d) => d.cause === 'summerade köp-typer').length;
  const suffix = doubled ? ` — Admiral summerar purchase, omni_purchase och offsite_conversion.fb_pixel_purchase som är samma köp` : '';
  return `${what[0].toUpperCase()}${what.slice(1)} på ${level === 'konto' ? 'kontonivå' : 'kampanjnivå'} avviker från Meta för ${n} ${level === 'konto' ? 'konto(n)' : 'kampanj(er)'} (${view.label}-vyn)${suffix}`;
}

function whereFor(level, metric, list) {
  const file = level === 'konto' ? 'netlify/functions/meta-accounts.js' : 'netlify/functions/meta-campaigns.js';
  if (metric === 'antal kampanjer') {
    const over = list.some((d) => d.source > 20 && d.admiral === 20);
    return `${file}${over ? ' (campaigns-anropet har limit=20 utan paginering)' : ''}`;
  }
  if (list.some((d) => d.cause === 'summerade köp-typer')) return `${file} (köp-mappning från actions/action_values)`;
  return file;
}

// ── 2. Lagrade siffror ──────────────────────────────────────────────────────
async function checkStored(ctx) {
  const { supabase, config, options = {} } = ctx;
  const out = [];
  const today = stockholmDate();
  const to = options.storedTo || addDays(today, -config.dataLagDays);
  const from = options.storedFrom || addDays(to, -config.storedWindowDays + 1);

  let filter = `select=id,budget_plan_id,log_date,planned_spend,actual_spend,pacing_ratio,manual_revenue,real_roas,created_at,budget_plans!inner(id,user_id,campaign_id,campaign_name,users(email,company_name))&log_date=gte.${from}&log_date=lte.${to}&order=log_date.asc`;
  if (options.planId) filter += `&budget_plan_id=eq.${options.planId}`;
  const rows = (await supabase.select('spend_log', filter)).filter(writtenByBudgetAdjust);

  const cache = new Map();
  const dailySpend = async (plan, month) => {
    const k = `${plan.campaign_id}|${month}`;
    if (!cache.has(k)) {
      cache.set(k, (async () => {
        const token = (await ctx.getValidMetaToken(plan.user_id)) || (await ctx.getValidMetaToken((await ctx.getAdminUser()).id));
        if (!token) throw new Error('inget giltigt Meta-token');
        const until = addDays(monthStart(addDays(month, 32)), -1);
        const rowsM = await ctx.meta.getAll(`${plan.campaign_id}/insights`, {
          fields: 'spend', time_increment: 1, time_range: { since: month, until: until < to ? until : to },
        }, token);
        return new Map(rowsM.map((r) => [r.date_start, Number(r.spend || 0)]));
      })());
    }
    return cache.get(k);
  };

  const bounds = async (row) => {
    const plan = row.budget_plans;
    const month = monthStart(row.log_date);
    const days = await dailySpend(plan, month);
    let lower = 0;
    for (let d = month; d < row.log_date; d = addDays(d, 1)) lower += days.get(d) || 0;
    return { lower: round(lower), upper: round(lower + (days.get(row.log_date) || 0)) };
  };

  for (const row of rows) {
    const plan = row.budget_plans;
    const customer = plan.users?.company_name || plan.users?.email || `user ${plan.user_id}`;
    const id = `data.spend_log ${row.id}`;
    const where = `spend_log id ${row.id} (plan ${plan.id} "${plan.campaign_name}", ${row.log_date})`;
    let b;
    try { b = await bounds(row); } catch (e) {
      out.push(fail(A, id, `Kunde inte hämta Meta-spend för ${plan.campaign_name} ${row.log_date}: ${e.message}`, { where }));
      continue;
    }
    const stored = Number(row.actual_spend);
    const verdict = bracketCheck(stored, b.lower, b.upper, config.tolerance);
    if (verdict.ok) { out.push(pass(A, id)); continue; }

    const recheck = async () => {
      const [cur] = await supabase.select('spend_log', `select=actual_spend&id=eq.${row.id}`);
      const v = bracketCheck(Number(cur.actual_spend), b.lower, b.upper, config.tolerance);
      return v.ok ? { ok: true } : { ok: false, cause: `actual_spend ${cur.actual_spend} ligger fortfarande utanför ${b.lower}–${b.upper}` };
    };
    const result = fail(A, id, `Lagrad spend för ${plan.campaign_name} ${row.log_date} är ${stored} kr; Meta anger ${b.lower}–${b.upper} kr för samma period`, {
      where,
      human: false,
      recheck,
      deviations: [{ customer, account: null, campaign: `${plan.campaign_name} (${plan.campaign_id})`, metric: `spend_log.actual_spend ${row.log_date}`, admiral: stored, source: `${b.lower}–${b.upper}`, diff: round(stored - (stored > b.upper ? b.upper : b.lower)) }],
    });
    result.action = await resyncSpendLog(ctx, row, b.upper);
    result.human = !result.action.ok;
    out.push(result);
  }

  // total_spent ska vara samma som senaste loggade actual_spend (budget-adjust skriver båda).
  out.push(...await checkTotals(ctx));
  return out;
}

// Rader som budget-adjust själv skrivit (schemat 06:00 UTC, samma dygn).
// Manuellt efterregistrerade rader har annan semantik och jämförs inte.
export function writtenByBudgetAdjust(row) {
  const created = String(row.created_at).replace(' ', 'T');
  const hour = Number(created.slice(11, 13));
  return created.slice(0, 10) === row.log_date && hour >= 5 && hour < 9;
}

async function resyncSpendLog(ctx, row, closedDaySpend) {
  const before = { actual_spend: Number(row.actual_spend), pacing_ratio: Number(row.pacing_ratio), real_roas: Number(row.real_roas) };
  const planned = Number(row.planned_spend);
  const manual = Number(row.manual_revenue || 0);
  const after = {
    actual_spend: closedDaySpend,
    pacing_ratio: planned > 0 ? round(closedDaySpend / planned, 4) : 0,
    real_roas: closedDaySpend > 0 ? manual / closedDaySpend : 0,
  };
  const action = { kind: 'resync', description: `Omsynk av spend_log id ${row.id} från Meta (stängt dygn ${row.log_date})`, table: 'spend_log', row_id: row.id, before, after };
  if (ctx.dryRun) return { ...action, ok: false, skipped: 'torrkörning' };
  try {
    await ctx.supabase.patch('spend_log', `id=eq.${row.id}`, after);
    return { ...action, ok: true };
  } catch (e) {
    return { ...action, ok: false, error: e.message };
  }
}

async function checkTotals(ctx) {
  const { supabase } = ctx;
  const out = [];
  const plans = await supabase.select('budget_plans', 'select=id,campaign_name,total_spent,status&status=eq.active');
  for (const plan of plans) {
    const [last] = await supabase.select('spend_log', `select=actual_spend,log_date&budget_plan_id=eq.${plan.id}&order=log_date.desc&limit=1`);
    if (!last) continue;
    const id = `data.total_spent plan ${plan.id}`;
    if (Math.abs(Number(plan.total_spent) - Number(last.actual_spend)) <= 0.01) { out.push(pass(A, id)); continue; }
    const recheck = async () => {
      const [p] = await supabase.select('budget_plans', `select=total_spent&id=eq.${plan.id}`);
      return Math.abs(Number(p.total_spent) - Number(last.actual_spend)) <= 0.01 ? { ok: true } : { ok: false, cause: 'total_spent avviker fortfarande' };
    };
    const result = fail(A, id, `budget_plans.total_spent för ${plan.campaign_name} är ${plan.total_spent} kr men senaste spend_log (${last.log_date}) är ${last.actual_spend} kr`, {
      where: `budget_plans id ${plan.id}`, human: false, recheck,
    });
    const before = { total_spent: Number(plan.total_spent) };
    const after = { total_spent: Number(last.actual_spend) };
    if (ctx.dryRun) result.action = { kind: 'resync', description: `Synka total_spent för plan ${plan.id}`, before, after, ok: false, skipped: 'torrkörning' };
    else {
      try {
        await supabase.patch('budget_plans', `id=eq.${plan.id}`, after);
        result.action = { kind: 'resync', description: `Synkade total_spent för plan ${plan.id} med senaste spend_log`, table: 'budget_plans', row_id: plan.id, before, after, ok: true };
      } catch (e) {
        result.action = { kind: 'resync', description: `Synka total_spent för plan ${plan.id}`, before, after, ok: false, error: e.message };
      }
    }
    result.human = !result.action.ok;
    out.push(result);
  }
  return out;
}
