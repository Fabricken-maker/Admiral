// Agent 2, del 2 — Veckovyn (Modul C) mot Meta.
//
// weekly_metrics skrivs av weekly-sync (dagligen 05:15 UTC). Varje vecka vars
// 72-timmarsgräns har passerat jämförs mot Meta, hämtad oberoende per vecka
// (time_range för just veckan, inte time_increment som synken använder):
//  - kontosumma och varje kampanj: spend och intäkt ±1 %, resultat exakt
//  - raden får inte längre vara markerad preliminär
// Tillåten reparation: omsynk av raden från Meta (föregående värden sparas).
// Sedan läses /api/weekly så som kunden ser den och jämförs mot weekly_metrics.
import { pass, fail } from '../lib/result.js';
import { actionValue, PURCHASE_TYPES } from '../lib/metrics.js';
import { compareAmount, compareInt, round } from '../lib/compare.js';
import { addDays, completedWeekStarts, weekFinalAfter } from '../lib/time.js';

const A = 'data';
const TOTAL_ID = '_konto';
const WEEKS = 8;
const METRICS = [['spend', 'amount'], ['results', 'int'], ['revenue', 'amount']];
const ZERO = { spend: 0, results: 0, revenue: 0 };

export async function checkWeekly(ctx) {
  let customers;
  try {
    customers = await ctx.supabase.select('weekly_settings', 'select=*,users!inner(id,email,company_name)&active=eq.true');
  } catch (e) {
    return [fail(A, 'data.veckovy', `Kunde inte läsa weekly_settings: ${e.message}`, { where: 'Supabase weekly_settings' })];
  }
  const out = [];
  for (const c of customers) out.push(...await checkCustomer(ctx, c));
  return out;
}

async function checkCustomer(ctx, c) {
  const { supabase, config } = ctx;
  const label = c.users.company_name || c.users.email;
  const now = ctx.options?.now ? new Date(ctx.options.now) : new Date();
  const weeks = completedWeekStarts(WEEKS, now);
  const types = c.result_action_types?.length ? c.result_action_types : PURCHASE_TYPES;
  const admin = await ctx.getAdminUser();
  const token = (await ctx.getValidMetaToken(c.user_id)) || (admin ? await ctx.getValidMetaToken(admin.id) : null);
  if (!token) {
    return [fail(A, `data.veckovy ${label}`, `Inget giltigt Meta-token för ${label} eller admin — veckovyn kunde inte jämföras mot Meta`, { where: `meta_tokens user_id ${c.user_id}` })];
  }

  const out = [];
  const due = weeks.filter((w) => weekFinalAfter(w) <= now);
  let compared = 0;
  for (const acc of c.ad_account_ids || []) {
    const rows = await supabase.select('weekly_metrics', rowQuery(c.user_id, acc, weeks[0]));
    for (const w of due) {
      const id = `data.veckovy ${label} ${acc} ${w}`;
      const mine = rows.filter((r) => r.week_start === w);
      if (!mine.some((r) => r.campaign_id === TOTAL_ID)) {
        out.push(fail(A, id, `Vecka ${w} saknas i weekly_metrics för ${label} (${acc})`, { where: 'netlify/functions/weekly-sync.js (schema 15 5 * * *)' }));
        continue;
      }
      let truth;
      try {
        truth = await fetchWeekTruth(ctx.meta, acc, w, types, token);
      } catch (e) {
        out.push(fail(A, id, `Kunde inte hämta Meta-siffror för ${label} vecka ${w}: ${e.message}`, { where: `Meta ${acc}` }));
        continue;
      }
      const devs = diffWeek({ customer: label, account: acc, week: w, rows: mine, truth, tolerance: config.tolerance });
      compared += (1 + truth.campaigns.size) * METRICS.length;
      if (!devs.length) { out.push(pass(A, id)); continue; }

      const recheck = async () => {
        const now2 = await supabase.select('weekly_metrics', `${rowQuery(c.user_id, acc, w)}&week_start=eq.${w}`);
        const still = diffWeek({ customer: label, account: acc, week: w, rows: now2, truth, tolerance: config.tolerance });
        return still.length ? { ok: false, cause: `${still.length} avvikelser kvar i weekly_metrics` } : { ok: true };
      };
      const result = fail(A, id, causeFor(label, w, devs), {
        where: `weekly_metrics (${label}, ${acc}, vecka ${w}) — skrivs av netlify/functions/weekly-sync.js`,
        human: false,
        recheck,
        deviations: devs.map(({ row_id: _r, campaign_id: _c, name: _n, ...d }) => d),
      });
      result.action = await resyncWeek(ctx, { userId: c.user_id, account: acc, week: w, devs, truth });
      result.human = !result.action.ok;
      out.push(result);
    }
  }
  out.push(await checkApi(ctx, c, label, admin));
  ctx.metrics.weekly_compared = { ...(ctx.metrics.weekly_compared || {}), [label]: { weeks: due.length, values: compared } };
  return out;
}

const rowQuery = (userId, acc, since) =>
  `select=id,campaign_id,campaign_name,week_start,spend,results,revenue,is_preliminary,fetched_at&user_id=eq.${userId}&ad_account_id=eq.${acc}&week_start=gte.${since}`;

async function fetchWeekTruth(meta, acc, week, types, token) {
  const time_range = { since: week, until: addDays(week, 6) };
  const [accRows, campRows] = await Promise.all([
    meta.getAll(`${acc}/insights`, { level: 'account', fields: 'spend,actions,action_values', time_range }, token),
    meta.getAll(`${acc}/insights`, { level: 'campaign', fields: 'campaign_id,campaign_name,spend,actions,action_values', time_range }, token),
  ]);
  return {
    total: weekValues(accRows[0], types),
    campaigns: new Map(campRows.map((r) => [r.campaign_id, { name: r.campaign_name, ...weekValues(r, types) }])),
  };
}

export function weekValues(row, types = PURCHASE_TYPES) {
  return {
    spend: round(Number(row?.spend || 0), 2),
    results: actionValue(row?.actions, types),
    revenue: round(actionValue(row?.action_values, types), 2),
  };
}

// Avvikelser mellan lagrade veckorader och Meta för en vecka och ett konto.
export function diffWeek({ customer, account, week, rows, truth, tolerance }) {
  const devs = [];
  const cmp = (row, campaignId, name, t) => {
    for (const [metric, kind] of METRICS) {
      const stored = Number(row?.[metric] ?? 0);
      const r = kind === 'int' ? compareInt(stored, t[metric]) : compareAmount(stored, t[metric], tolerance);
      if (!r.ok) {
        devs.push({
          customer, account, week, campaign: campaignId === TOTAL_ID ? 'kontosumma' : `${name} (${campaignId})`,
          metric, admiral: row ? stored : 'saknas', source: t[metric], diff: r.diff,
          row_id: row?.id ?? null, campaign_id: campaignId, name,
        });
      }
    }
  };
  const total = rows.find((r) => r.campaign_id === TOTAL_ID);
  cmp(total, TOTAL_ID, null, truth.total);
  const camps = rows.filter((r) => r.campaign_id !== TOTAL_ID);
  for (const r of camps) cmp(r, r.campaign_id, r.campaign_name, truth.campaigns.get(r.campaign_id) || ZERO);
  for (const [cid, t] of truth.campaigns) {
    if (!camps.some((r) => r.campaign_id === cid) && (t.spend > 0 || t.results > 0 || t.revenue > 0)) cmp(null, cid, t.name, t);
  }
  for (const r of rows.filter((x) => x.is_preliminary)) {
    devs.push({
      customer, account, week, campaign: r.campaign_id === TOTAL_ID ? 'kontosumma' : `${r.campaign_name} (${r.campaign_id})`,
      metric: 'preliminär', admiral: 'preliminär', source: 'slutlig (72 h passerade)', diff: null,
      row_id: r.id, campaign_id: r.campaign_id, name: r.campaign_name,
    });
  }
  return devs;
}

function causeFor(label, week, devs) {
  const stale = devs.filter((d) => d.metric === 'preliminär').length;
  const values = devs.length - stale;
  const parts = [];
  if (values) parts.push(`${values} värde(n) i veckovyn avviker från Meta`);
  if (stale) parts.push(`${stale} rad(er) är fortfarande markerade preliminära fast 72 h har passerat (veckan räknades inte om)`);
  return `${label}, vecka ${week}: ${parts.join('; ')}`;
}

// Omsynk: raderna med avvikelser skrivs om med Metas värden och markeras slutliga.
async function resyncWeek(ctx, { userId, account, week, devs, truth }) {
  const fetchedAt = new Date().toISOString();
  const byRow = new Map();
  for (const d of devs) {
    const key = d.row_id ?? `ny:${d.campaign_id}`;
    if (!byRow.has(key)) byRow.set(key, d);
  }
  const changes = [];
  for (const [key, d] of byRow) {
    const t = d.campaign_id === TOTAL_ID ? truth.total : (truth.campaigns.get(d.campaign_id) || ZERO);
    changes.push({ key, row_id: d.row_id, campaign_id: d.campaign_id, name: d.name, after: { ...pickValues(t), is_preliminary: false, fetched_at: fetchedAt } });
  }
  // before/after som platta { "kampanj mått": värde } så att rapporten kan skriva ut dem.
  const before = {};
  const after = {};
  for (const d of devs) {
    const key = `${d.campaign_id === TOTAL_ID ? 'kontosumma' : d.name || d.campaign_id} ${d.metric}`;
    const t = d.campaign_id === TOTAL_ID ? truth.total : (truth.campaigns.get(d.campaign_id) || ZERO);
    before[key] = d.admiral;
    after[key] = d.metric === 'preliminär' ? 'slutlig' : t[d.metric];
  }
  const action = {
    kind: 'resync',
    description: `Omsynk av ${changes.length} veckorad(er) från Meta (${account}, vecka ${week})`,
    table: 'weekly_metrics',
    rows: changes.map((c) => ({ row_id: c.row_id, campaign_id: c.campaign_id, ...c.after })),
    before,
    after,
  };
  if (ctx.dryRun) return { ...action, ok: false, skipped: 'torrkörning' };
  try {
    for (const c of changes) {
      if (c.row_id) {
        await ctx.supabase.patch('weekly_metrics', `id=eq.${c.row_id}`, c.after);
      } else {
        await ctx.supabase.insert('weekly_metrics', [{
          user_id: userId, ad_account_id: account, campaign_id: c.campaign_id, campaign_name: c.name || null,
          week_start: week, week_end: addDays(week, 6), ...c.after,
        }]);
      }
    }
    return { ...action, ok: true };
  } catch (e) {
    return { ...action, ok: false, error: e.message };
  }
}

const pickValues = (t) => ({ spend: t.spend, results: t.results, revenue: t.revenue });

// Det kunden ser: /api/weekly ska visa exakt kontosummorna i weekly_metrics,
// och "Preliminär" ska följa 72-timmarsregeln.
async function checkApi(ctx, c, label, admin) {
  const id = `data.veckovy api ${label}`;
  const where = 'netlify/functions/weekly.js';
  if (!admin) return fail(A, id, 'Admin-kontot saknas — /api/weekly kunde inte läsas', { where: 'Supabase users' });
  const recheck = async () => {
    const r = await ctx.admiral.api(`/api/weekly?user_id=${c.user_id}`, { token: ctx.admiral.tokenFor(admin) });
    if (r.status === 404) return { ok: false, cause: 'Veckovyn (/api/weekly) finns inte i den driftsatta versionen av Admiral' };
    if (r.status !== 200) return { ok: false, cause: `/api/weekly svarade HTTP ${r.status || r.error}` };
    if (!r.json?.enabled || r.json.status !== 'ok') return { ok: false, cause: `/api/weekly visar ingen vecka för ${label} (${r.json?.status || 'avstängd'})` };
    const since = r.json.series[0].week_start;
    const rows = await ctx.supabase.select('weekly_metrics', `select=ad_account_id,week_start,spend,results,revenue,fetched_at&user_id=eq.${c.user_id}&campaign_id=eq.${TOTAL_ID}&week_start=gte.${since}`);
    const problems = compareApiSeries(r.json, rows.filter((x) => (c.ad_account_ids || []).includes(x.ad_account_id)));
    return problems.length ? { ok: false, cause: `Veckovyn för ${label} stämmer inte med weekly_metrics: ${problems.slice(0, 4).join('; ')}` } : { ok: true };
  };
  const r = await recheck();
  return r.ok ? pass(A, id) : fail(A, id, r.cause, { where, recheck });
}

export function compareApiSeries(view, totals) {
  const problems = [];
  const byWeek = new Map();
  for (const t of totals) {
    const w = byWeek.get(t.week_start) || { spend: 0, results: 0, revenue: 0, preliminary: false };
    w.spend += Number(t.spend); w.results += Number(t.results); w.revenue += Number(t.revenue);
    if (new Date(t.fetched_at) < weekFinalAfter(t.week_start)) w.preliminary = true;
    byWeek.set(t.week_start, w);
  }
  const latest = [...byWeek.keys()].sort().at(-1);
  if (view.week.start !== latest) problems.push(`visar vecka ${view.week.start}, senaste synkade är ${latest}`);
  for (const s of view.series) {
    const db = byWeek.get(s.week_start);
    if (!db) { problems.push(`vecka ${s.week_start} finns inte i weekly_metrics`); continue; }
    for (const m of ['spend', 'revenue']) {
      if (Math.abs(Number(s[m]) - round(db[m], 2)) > 0.01) problems.push(`vecka ${s.week_start} ${m} ${s[m]} ≠ ${round(db[m], 2)}`);
    }
    if (Number(s.results) !== db.results) problems.push(`vecka ${s.week_start} resultat ${s.results} ≠ ${db.results}`);
    if (s.preliminary !== db.preliminary) problems.push(`vecka ${s.week_start} märkt ${s.preliminary ? 'preliminär' : 'slutlig'}, regeln ger ${db.preliminary ? 'preliminär' : 'slutlig'}`);
  }
  if (view.week.preliminary !== view.series.at(-1)?.preliminary) problems.push('veckans Preliminär-märkning följer inte serien');
  return problems;
}
