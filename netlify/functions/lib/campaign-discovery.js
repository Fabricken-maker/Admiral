/**
 * Admiral — Kampanjupptäckt (endast läsning mot Meta).
 *
 * Hittar kundens kampanjer i Meta och speglar dem i budget_plans, så att en kampanj
 * syns i dashboarden utan att någon manuellt lägger upp en plan.
 *
 * Regler:
 *  - Kampanjer med status ACTIVE och PAUSED hämtas; ARCHIVED/DELETED hoppas över.
 *  - En ny plan skapas bara för ACTIVE kampanjer utan öppen plan (öppen = active/paused).
 *    Pausade kampanjer utan plan får ingen: gamla pausade kampanjer ska inte bli brus.
 *  - Budgeten läses från Meta och är sanningen (inte inmatad):
 *      dagsbudget på kampanjen  → månadsbudget = dagsbudget × dagar i innevarande månad
 *      lifetime-budget          → hela beloppet, perioden = kampanjens start/slut
 *      ingen kampanjbudget (ABO) → summan av annonsuppsättningarnas dagsbudgetar,
 *                                  sparade per ad set i ad_set_allocations
 *    Meta anger belopp i minsta valutaenhet (öre för SEK) → delas med 100.
 *  - Öppna planer synkas varje körning: namn, budget och status (ACTIVE→active,
 *    PAUSED→paused). Mål (ROAS, CPA, intäkt, kurser) och anteckningar rörs ALDRIG här.
 *  - Planer med status completed rörs aldrig och återöppnas inte. Vid månadsskifte
 *    stängs förra månadens plan (completed) och en ny skapas — samma svep som
 *    budget-adjust gör. Kampanjer som försvunnit ur Meta (arkiverade) stängs också.
 *  - Idempotent: samma körning två gånger ger inga dubbletter och inga ändringar.
 */
import { graphGet, withTokens } from './meta-graph.js';

export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
const round2 = (x) => Math.round(x * 100) / 100;
const asAct = (a) => (String(a).startsWith('act_') ? String(a) : `act_${a}`);

// Innevarande kalendermånad (UTC, samma dygnsgräns som övriga schemalagda jobb).
export function monthPeriod(today) {
  const [y, m] = today.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { month_start: `${y}-${mm}-01`, month_end: `${y}-${mm}-${String(days).padStart(2, '0')}`, days };
}

// Alla sidor från en Graph-kant. Pagineras med cursor (inte paging.next, som bär token i URL:en).
export async function graphGetAll(path, params, token, fetchImpl = fetch) {
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const json = await graphGet(path, { ...params, limit: 500, ...(after ? { after } : {}) }, token, fetchImpl);
    out.push(...(json.data || []));
    after = json.paging?.next ? json.paging?.cursors?.after : null;
    if (!after) break;
  }
  return out;
}

/**
 * Konto, kampanjer och annonsuppsättningar för ett annonskonto (tre GET, endast läsning).
 * Returnerar bara ACTIVE/PAUSED, med ad sets grupperade per kampanj.
 */
export async function fetchAccountData(adAccountId, token, fetchImpl = fetch) {
  const LIVE = ['ACTIVE', 'PAUSED'];
  const [account, campaigns, adsets] = await Promise.all([
    graphGet(adAccountId, { fields: 'currency' }, token, fetchImpl),
    graphGetAll(`${adAccountId}/campaigns`, { fields: 'id,name,status,daily_budget,lifetime_budget,start_time,stop_time' }, token, fetchImpl),
    graphGetAll(`${adAccountId}/adsets`, { fields: 'id,name,status,campaign_id,daily_budget,lifetime_budget,start_time,end_time' }, token, fetchImpl),
  ]);
  const byCampaign = {};
  for (const a of adsets) {
    if (!LIVE.includes(a.status)) continue;
    (byCampaign[a.campaign_id] ||= []).push(a);
  }
  return {
    currency: account.currency || 'SEK',
    campaigns: campaigns
      .filter((c) => LIVE.includes(c.status))
      .map((c) => ({ ...c, adsets: byCampaign[c.id] || [] })),
  };
}

// Dagsbudget i ören för en annonsuppsättning; lifetime slås ut över dess egen period.
function adsetDailyCents(a) {
  if (a.daily_budget) return Number(a.daily_budget);
  if (a.lifetime_budget) {
    const start = (a.start_time || '').slice(0, 10);
    const end = (a.end_time || '').slice(0, 10);
    if (!start || !end) return 0;
    const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1);
    return Math.round(Number(a.lifetime_budget) / days);
  }
  return 0;
}

/**
 * Budget och period för en kampanj. adsets är null för CBO (budgeten ligger på kampanjen),
 * annars listan som ska speglas i ad_set_allocations.
 */
export function campaignBudget(c, period) {
  if (c.lifetime_budget) {
    return {
      monthly: round2(Number(c.lifetime_budget) / 100),
      month_start: (c.start_time || '').slice(0, 10) || period.month_start,
      month_end: (c.stop_time || '').slice(0, 10) || period.month_end,
      lifetime: true,
      adsets: null,
    };
  }
  if (c.daily_budget) {
    return { monthly: round2((Number(c.daily_budget) / 100) * period.days), month_start: period.month_start, month_end: period.month_end, adsets: null };
  }
  // ABO: aktiva ad sets räknas; är alla pausade (t.ex. pausad kampanj) räknas de pausade.
  const active = (c.adsets || []).filter((a) => a.status === 'ACTIVE');
  const counted = active.length ? active : (c.adsets || []);
  const rows = counted.map((a) => ({ id: a.id, name: a.name || null, daily_cents: adsetDailyCents(a) }));
  const sumCents = rows.reduce((s, a) => s + a.daily_cents, 0);
  return { monthly: round2((sumCents / 100) * period.days), month_start: period.month_start, month_end: period.month_end, adsets: rows };
}

/**
 * Ren logik: vad ska skrivas givet Metas kampanjer och befintliga planer.
 * Returnerar { completes, updates, inserts, allocationSync } utan att röra databasen.
 */
export function planChanges({ userId, adAccountId, currency, campaigns, existingPlans, today }) {
  const period = monthPeriod(today);
  const open = existingPlans.filter((p) => p.status !== 'completed'); // completed rörs aldrig
  const liveIds = new Set(campaigns.map((c) => c.id));

  const completes = new Set();
  for (const p of open) {
    if (p.month_end < today) completes.add(p.id); // perioden har passerat (månadsskifte)
    else if (!liveIds.has(p.campaign_id)) completes.add(p.id); // arkiverad/raderad i Meta
  }

  // Senaste öppna, ännu gällande plan per kampanj
  const current = new Map();
  for (const p of open) {
    if (completes.has(p.id)) continue;
    const prev = current.get(p.campaign_id);
    if (!prev || p.id > prev.id) current.set(p.campaign_id, p);
  }

  const now = new Date().toISOString();
  const updates = [];
  const inserts = [];
  const allocationSync = [];

  for (const c of campaigns) {
    const budget = campaignBudget(c, period);
    const status = c.status === 'PAUSED' ? 'paused' : 'active';
    const plan = current.get(c.id);

    if (plan) {
      const patch = {};
      if ((plan.campaign_name || null) !== c.name) patch.campaign_name = c.name;
      if (Number(plan.monthly_budget) !== budget.monthly) patch.monthly_budget = budget.monthly;
      if ((plan.currency || 'SEK') !== currency) patch.currency = currency;
      if (plan.status !== status) patch.status = status;
      if (budget.lifetime) {
        // Kunden kan flytta start/slut på en lifetime-kampanj; perioden följer med.
        if (plan.month_start !== budget.month_start) patch.month_start = budget.month_start;
        if (plan.month_end !== budget.month_end) patch.month_end = budget.month_end;
      }
      if (Object.keys(patch).length) updates.push({ id: plan.id, patch: { ...patch, updated_at: now } });
      if (budget.adsets) allocationSync.push({ planId: plan.id, adsets: budget.adsets });
    } else if (c.status === 'ACTIVE') {
      inserts.push({
        row: {
          user_id: userId,
          campaign_id: c.id,
          campaign_name: c.name,
          ad_account_id: adAccountId,
          monthly_budget: budget.monthly,
          currency,
          month_start: budget.month_start,
          month_end: budget.month_end,
          status, // mål (ROAS/CPA/intäkt) lämnas tomma tills kund eller Fabricken sätter dem
        },
        adsets: budget.adsets,
      });
    }
  }

  return { completes: [...completes], updates, inserts, allocationSync };
}

// Speglar ad_set_allocations mot Metas ad sets: uppdatera, lägg till, nollställ försvunna.
// allocation_pct på befintliga rader ägs av budget-adjust och rörs inte här.
async function syncAllocations(supabase, planId, adsets, nowIso) {
  const { data: existing, error } = await supabase
    .from('ad_set_allocations')
    .select('id, ad_set_id, ad_set_name, daily_budget_cents')
    .eq('budget_plan_id', planId);
  if (error) throw new Error(`ad_set_allocations: ${error.message}`);

  const totalCents = adsets.reduce((s, a) => s + a.daily_cents, 0);
  const seen = new Set();
  for (const a of adsets) {
    seen.add(a.id);
    const row = (existing || []).find((e) => e.ad_set_id === a.id);
    if (!row) {
      await supabase.from('ad_set_allocations').insert({
        budget_plan_id: planId,
        ad_set_id: a.id,
        ad_set_name: a.name,
        daily_budget_cents: a.daily_cents,
        allocation_pct: totalCents > 0 ? round2((a.daily_cents / totalCents) * 100) : 0,
      });
    } else if (Number(row.daily_budget_cents) !== a.daily_cents || (row.ad_set_name || null) !== a.name) {
      await supabase.from('ad_set_allocations')
        .update({ ad_set_name: a.name, daily_budget_cents: a.daily_cents, updated_at: nowIso })
        .eq('id', row.id);
    }
  }
  for (const e of existing || []) {
    if (!seen.has(e.ad_set_id) && Number(e.daily_budget_cents) !== 0) {
      await supabase.from('ad_set_allocations').update({ daily_budget_cents: 0, updated_at: nowIso }).eq('id', e.id);
    }
  }
}

/** Skriver ändringarna. Ny plan dubbelkollas mot öppna planer innan insert (idempotens utan unikt index). */
export async function applyChanges(supabase, changes) {
  const nowIso = new Date().toISOString();
  const summary = { completed: 0, updated: 0, created: 0 };

  if (changes.completes.length) {
    const { error } = await supabase.from('budget_plans')
      .update({ status: 'completed', updated_at: nowIso })
      .in('id', changes.completes);
    if (error) throw new Error(`budget_plans complete: ${error.message}`);
    summary.completed = changes.completes.length;
  }

  for (const u of changes.updates) {
    const { error } = await supabase.from('budget_plans').update(u.patch).eq('id', u.id);
    if (error) throw new Error(`budget_plans update: ${error.message}`);
    summary.updated += 1;
  }

  for (const ins of changes.inserts) {
    const { data: dup } = await supabase.from('budget_plans')
      .select('id')
      .eq('user_id', ins.row.user_id)
      .eq('ad_account_id', ins.row.ad_account_id)
      .eq('campaign_id', ins.row.campaign_id)
      .neq('status', 'completed')
      .limit(1);
    if (dup?.length) continue;
    const { data: plan, error } = await supabase.from('budget_plans').insert(ins.row).select('id').single();
    if (error) throw new Error(`budget_plans insert: ${error.message}`);
    if (ins.adsets?.length) await syncAllocations(supabase, plan.id, ins.adsets, nowIso);
    summary.created += 1;
  }

  for (const s of changes.allocationSync) {
    await syncAllocations(supabase, s.planId, s.adsets, nowIso);
  }
  return summary;
}

/** Upptäcker och synkar ett annonskonto för en kund. tokens som i lib/meta-graph withTokens. */
export async function discoverAccount({ supabase, userId, adAccountId, tokens, now = new Date(), fetchImpl = fetch }) {
  const { currency, campaigns } = await withTokens(tokens, (t) => fetchAccountData(adAccountId, t, fetchImpl));
  const { data: existingPlans, error } = await supabase
    .from('budget_plans')
    .select('id, campaign_id, campaign_name, status, month_start, month_end, monthly_budget, currency')
    .eq('user_id', userId)
    .eq('ad_account_id', adAccountId);
  if (error) throw new Error(`budget_plans: ${error.message}`);

  const changes = planChanges({ userId, adAccountId, currency, campaigns, existingPlans: existingPlans || [], today: isoDate(now) });
  const summary = await applyChanges(supabase, changes);
  return { ad_account_id: adAccountId, campaigns: campaigns.length, ...summary };
}

/**
 * Vilka annonskonton som ska upptäckas per kund (aktiva användare).
 * weekly_settings (aktiva) är sanningen; users.meta_ad_account_id/_2/_3 är reserv.
 * Ett reservkonto som finns i någon annans weekly_settings hoppas över — admins
 * users-rad pekar på kundkonton (se lib/review-store.js accountsFor).
 */
export async function accountsPerCustomer(supabase) {
  const [{ data: users, error: uErr }, { data: weekly, error: wErr }] = await Promise.all([
    supabase.from('users').select('id, meta_ad_account_id, meta_ad_account_id_2, meta_ad_account_id_3').eq('status', 'active'),
    supabase.from('weekly_settings').select('user_id, ad_account_ids').eq('active', true),
  ]);
  if (uErr) throw new Error(`users: ${uErr.message}`);
  if (wErr) throw new Error(`weekly_settings: ${wErr.message}`);

  const activeIds = new Set((users || []).map((u) => u.id));
  const claimedBy = new Map(); // konto → user_id enligt weekly_settings
  for (const w of weekly || []) {
    if (!activeIds.has(w.user_id)) continue;
    for (const a of w.ad_account_ids || []) if (!claimedBy.has(asAct(a))) claimedBy.set(asAct(a), w.user_id);
  }

  const out = new Map(); // user_id → { accounts:Set, weeklyAccounts:[], hasPrimary }
  const entry = (id) => out.get(id) || out.set(id, { accounts: new Set(), weeklyAccounts: [], hasPrimary: false }).get(id);
  for (const w of weekly || []) {
    if (!activeIds.has(w.user_id)) continue;
    const e = entry(w.user_id);
    for (const a of w.ad_account_ids || []) {
      e.accounts.add(asAct(a));
      e.weeklyAccounts.push(asAct(a));
    }
  }
  for (const u of users || []) {
    const fallback = [u.meta_ad_account_id, u.meta_ad_account_id_2, u.meta_ad_account_id_3].filter(Boolean).map(asAct);
    for (const a of fallback) {
      const owner = claimedBy.get(a);
      if (owner && owner !== u.id) continue; // kundens konto, inte adminens kopia
      entry(u.id).accounts.add(a);
    }
    if (out.has(u.id)) out.get(u.id).hasPrimary = Boolean(u.meta_ad_account_id);
  }

  return [...out.entries()]
    .map(([userId, e]) => ({ userId, accounts: [...e.accounts], weeklyAccounts: e.weeklyAccounts, hasPrimary: e.hasPrimary }))
    .filter((c) => c.accounts.length);
}

/**
 * Fyller users.meta_ad_account_id/_2/_3 när de saknas (onboarding/omkoppling).
 * Källa i prioritetsordning: weekly_settings → Metas me/adaccounts om kunden bara har ETT konto.
 * Skriver aldrig över befintliga värden.
 */
export async function backfillAdAccounts(supabase, userId, token = null, fetchImpl = fetch) {
  const { data: u, error } = await supabase
    .from('users')
    .select('meta_ad_account_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`users: ${error.message}`);
  if (!u || u.meta_ad_account_id) return null;

  let accounts = [];
  const { data: w } = await supabase.from('weekly_settings').select('ad_account_ids').eq('user_id', userId).maybeSingle();
  if (w?.ad_account_ids?.length) {
    accounts = w.ad_account_ids.map(asAct);
  } else if (token) {
    const me = await graphGetAll('me/adaccounts', { fields: 'id' }, token, fetchImpl).catch(() => []);
    if (me.length === 1) accounts = [asAct(me[0].id)]; // flera konton: gissa aldrig
  }
  if (!accounts.length) return null;

  const patch = {
    meta_ad_account_id: accounts[0],
    meta_ad_account_id_2: accounts[1] || null,
    meta_ad_account_id_3: accounts[2] || null,
  };
  const { error: upErr } = await supabase.from('users').update(patch).eq('id', userId);
  if (upErr) throw new Error(`users update: ${upErr.message}`);
  return patch.meta_ad_account_id;
}
