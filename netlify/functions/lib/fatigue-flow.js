/**
 * Admiral Modul E — flödet: upptäck trötta annonser → ta fram varianter → granska (Modul B)
 * → godkänd variant blir förslag (Modul D) → följ upp efter bytet.
 *
 * Underkända varianter, och varianter som väntar på granskning, blir aldrig förslag.
 */
import crypto from 'node:crypto';
import { graphGet, withTokens } from './meta-graph.js';
import { assessAccount, normalizeFatigueSettings, fatigueReason, expectedOutcome, aggregate, weekFromInsight, compareFollowup } from './fatigue.js';
import { weeklyAdInsights, adPeriod } from './fatigue-meta.js';
import { generateCopyVariants } from './copy-variants.js';
import { buildSwapSpec, swapValues } from './creative-swap.js';
import { isApprovedVariant } from './meta-write.js';
import { checkLimits, confirmationText, describe, normalizeWriteSettings } from './proposals.js';
import { visionAvailable } from './review-vision.js';
import { PURCHASE_TYPES, stockholmDate, addDays } from './weekly.js';

export const LABELS = 'BCDEFGHIJ'.split('');
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

export async function fatigueSettings(supabase, userId) {
  const { data } = await supabase.from('fatigue_settings').select('*').eq('user_id', userId).maybeSingle();
  return normalizeFatigueSettings(data);
}

export async function resultTypesFor(supabase, userId) {
  const { data } = await supabase.from('weekly_settings').select('result_action_types').eq('user_id', userId).maybeSingle();
  return data?.result_action_types?.length ? data.result_action_types : PURCHASE_TYPES;
}

// ── 1. Upptäckt ───────────────────────────────────────────────────────────
export async function detectFatigue({ supabase, userId, accounts, tokens, now = new Date(), get }) {
  const settings = await fatigueSettings(supabase, userId);
  if (!settings.enabled) return { skipped: 'avstängt' };
  const resultTypes = await resultTypesFor(supabase, userId);
  const open = must(await supabase.from('ad_fatigue').select('id, ad_id, proposal_id').eq('user_id', userId).eq('status', 'trott'), 'ad_fatigue');
  const openByAd = new Map(open.map((r) => [r.ad_id, r]));
  const out = { flagged: [], updated: [], recovered: [], assessed: 0 };

  for (const account of accounts) {
    const { rows, lastWeekStart } = await withTokens(tokens, (token) => weeklyAdInsights(account, token, { weeks: settings.lookback_weeks, now, get }));
    const assessed = assessAccount(rows, settings, lastWeekStart, resultTypes);
    out.assessed += assessed.length;
    for (const a of assessed) {
      const existing = openByAd.get(a.ad_id);
      if (a.status === 'trott') {
        const row = {
          ad_account_id: account, ad_name: a.ad_name, adset_id: a.adset_id, campaign_id: a.campaign_id,
          campaign_name: a.campaign_name, week_start: lastWeekStart, metrics: a.metrics, updated_at: now.toISOString(),
        };
        if (existing) {
          must(await supabase.from('ad_fatigue').update(row).eq('id', existing.id), 'ad_fatigue');
          out.updated.push(existing.id);
        } else {
          const created = must(await supabase.from('ad_fatigue').insert({ ...row, user_id: userId, ad_id: a.ad_id, status: 'trott', variants_requested_at: now.toISOString() }).select('id').single(), 'ad_fatigue');
          out.flagged.push(created.id);
        }
      } else if (a.status === 'ok' && existing && !existing.proposal_id) {
        // Annonsen presterar som förut igen: inget att byta.
        must(await supabase.from('ad_fatigue').update({ status: 'aterhamtad', metrics: a.metrics, week_start: lastWeekStart, updated_at: now.toISOString() }).eq('id', existing.id), 'ad_fatigue');
        out.recovered.push(existing.id);
      }
    }
  }
  return out;
}

// ── 2. Varianter ──────────────────────────────────────────────────────────
// Bilden eller videoomslaget från annonsen (granskat i Modul B) som varianterna utgår från.
export async function originalReviewFor(supabase, fatigue) {
  const rows = must(await supabase.from('creative_reviews')
    .select('*').eq('user_id', fatigue.user_id).eq('ad_id', fatigue.ad_id).eq('source', 'meta')
    .order('created_at', { ascending: false }).limit(10), 'creative_reviews');
  const done = rows.find((r) => r.status === 'klar' && r.image_path);
  return { review: done || null, pending: rows.some((r) => r.status === 'koar' || r.status === 'analyserar') };
}

export async function nextLabel(supabase, fatigueId) {
  const rows = must(await supabase.from('creative_reviews').select('variant_label').eq('fatigue_id', fatigueId), 'creative_reviews');
  const used = new Set(rows.map((r) => r.variant_label));
  return LABELS.find((l) => !used.has(l)) || null;
}

export function variantRow({ fatigue, original, label, texts, source = 'admiral', createdBy = null }) {
  const contentKey = crypto.createHash('sha256').update(JSON.stringify({ fatigue: fatigue.id, label, asset: original.asset_key, texts })).digest('hex');
  return {
    user_id: fatigue.user_id, ad_account_id: fatigue.ad_account_id, source, ad_id: null,
    ad_name: `${fatigue.ad_name || 'Annons'} – variant ${label}`, campaign_name: fatigue.campaign_name,
    asset_key: original.asset_key, asset_type: original.asset_type, content_key: contentKey,
    original_review_id: original.id, image_path: original.image_path, image_sha256: original.image_sha256,
    width: original.width, height: original.height, texts, features: original.features,
    fatigue_id: fatigue.id, variant_label: label, status: 'koar', created_by: createdBy,
  };
}

/**
 * Tar fram Admirals egna varianter (nya texter till samma bild/video) för en trött annons.
 * Väntar om annonsens bild ännu inte är granskad. Returnerar antal köade varianter.
 */
export async function ensureVariants({ supabase, store, fatigue, now = new Date(), generate = generateCopyVariants, aiAvailable = visionAvailable() }) {
  const { review: original, pending } = await originalReviewFor(supabase, fatigue);
  if (!original) return { waiting: pending ? 'granskas' : 'saknar_granskning' };
  const settings = await fatigueSettings(supabase, fatigue.user_id);
  const patch = { original_review_id: original.id, updated_at: now.toISOString() };
  let queued = 0;
  let note = null;
  if (settings.copy_variants > 0 && aiAvailable) {
    const profile = await store.getProfile(fatigue.user_id);
    const { variants, rejected } = await generate({ texts: original.texts, profile, count: settings.copy_variants });
    for (const v of variants) {
      const label = await nextLabel(supabase, fatigue.id);
      if (!label) break;
      const texts = { bodies: [v.body], titles: [v.title], descriptions: v.description ? [v.description] : [], cta: original.texts?.cta || [], angle: v.angle };
      queued += (await store.enqueue([variantRow({ fatigue, original, label, texts })])).length;
    }
    if (rejected.length) note = `${rejected.length} textförslag stoppades före granskningen (${rejected.map((r) => r.errors[0]).join('; ')}).`;
  } else if (!aiAvailable) {
    note = 'Admirals egna varianter kräver AI. Ladda upp en variant i granskningen.';
  }
  must(await supabase.from('ad_fatigue').update({ ...patch, variants_generated_at: now.toISOString(), status_note: note }).eq('id', fatigue.id), 'ad_fatigue');
  return { queued, note };
}

// ── 3. Förslag (Modul D) ──────────────────────────────────────────────────
export class SwapRejected extends Error {
  constructor(message) { super(message); this.name = 'SwapRejected'; }
}

const AD_FIELDS = 'name,status,adset_id,account_id,campaign{objective},creative{id,call_to_action_type,object_story_spec,asset_feed_spec,degrees_of_freedom_spec}';

/**
 * En godkänd variant blir ett förslag att byta annons. Bara en väntande förslag per trött annons
 * (replace: true ersätter det väntande, t.ex. när Fabricken väljer en annan variant).
 */
export async function proposeFromVariant({ supabase, repo, store, review, tokens, now = new Date(), replace = false, fetchImpl = fetch }) {
  if (!isApprovedVariant(review)) return { skipped: 'inte_godkand' };
  const fatigue = must(await supabase.from('ad_fatigue').select('*').eq('id', review.fatigue_id).maybeSingle(), 'ad_fatigue');
  if (!fatigue || fatigue.status !== 'trott') return { skipped: 'inte_trott' };
  if (fatigue.proposal_id && !replace) {
    const prev = await repo.getProposal(fatigue.proposal_id);
    if (prev && ['pending', 'approved', 'verifying', 'done'].includes(prev.status)) return { skipped: 'har_forslag', proposal_id: prev.id };
  }

  const { data: ws } = await supabase.from('write_settings').select('*').eq('user_id', fatigue.user_id).maybeSingle();
  const settings = normalizeWriteSettings(ws);
  if (!settings.writes_enabled) throw new SwapRejected('Kunden har inte gett Admiral skrivbehörighet.');
  if (settings.kill_switch) throw new SwapRejected('Alla ändringar i Meta är stoppade för kunden (nödstopp).');
  if (!settings.ad_account_ids.includes(fatigue.ad_account_id)) throw new SwapRejected('Annonskontot är inte godkänt för ändringar.');

  const original = review.original_review_id ? await store.getReview(review.original_review_id) : null;
  const profile = await store.getProfile(fatigue.user_id);
  return withTokens(tokens, async (token) => {
    const old = await graphGet(fatigue.ad_id, { fields: AD_FIELDS }, token, fetchImpl);
    if (old.status !== 'ACTIVE') throw new SwapRejected('Den trötta annonsen är inte längre aktiv.');
    // Meta tar inte emot nya annonser i kampanjer med äldre mål (före OUTCOME_*).
    if (old.campaign?.objective && !/^OUTCOME_/.test(old.campaign.objective)) throw new SwapRejected('Kampanjen har ett äldre kampanjmål. Meta tar inte längre emot nya annonser i den.');
    let spec;
    try {
      spec = buildSwapSpec({ old: { ...old, ad_id: fatigue.ad_id }, variant: review, original, profile });
    } catch (e) {
      throw new SwapRejected(e.message);
    }
    const values = swapValues(fatigue.ad_id, old.status, old.creative?.id || null);
    const p = {
      user_id: fatigue.user_id, ad_account_id: fatigue.ad_account_id, type: 'creative_swap', kind: 'change',
      object_type: 'ad', object_id: fatigue.ad_id, object_name: old.name,
      current_value: values.current, proposed_value: values.proposed,
      meta: {
        swap: spec, variant_review_id: review.id, variant_label: review.variant_label, fatigue_id: fatigue.id,
        image_path: review.image_path, asset_type: review.asset_type,
        variant_kind: String(review.asset_key || '').startsWith('upl:') ? 'bild' : 'text',
        texts: { body: spec.message, title: spec.title, description: spec.description },
      },
      reason: fatigueReason(old.name, fatigue.metrics, review.variant_label),
      reason_data: { verdict: 'gor', support: [] },
      expected_outcome: expectedOutcome(fatigue.metrics),
      source: 'modul_e', created_by: null,
      valid_until: new Date(now.getTime() + settings.approval_ttl_hours * 3600000).toISOString(),
    };
    p.confirmation_text = confirmationText(p);

    const since = new Date(now.getTime() - settings.period_days * 86400000).toISOString();
    const periodWrites = (await repo.writesSince(fatigue.user_id, since)).filter((w) => w.status !== 'failed' && w.action === 'apply');
    const limits = checkLimits({ type: p.type, current: p.current_value, proposed: p.proposed_value, settings, periodWrites });
    if (!limits.ok) throw new SwapRejected(limits.errors.join(' '));

    await supabase.from('proposals').update({ status: 'superseded', updated_at: now.toISOString() })
      .eq('user_id', fatigue.user_id).eq('object_id', fatigue.ad_id).eq('type', 'creative_swap').eq('status', 'pending');
    const created = await repo.insertProposal({ ...p, status: 'pending' });
    must(await supabase.from('ad_fatigue').update({ proposal_id: created.id, status_note: null, updated_at: now.toISOString() }).eq('id', fatigue.id), 'ad_fatigue');
    return { proposal: { ...created, title: describe(created) } };
  });
}

// Försöker göra förslag av en granskad variant. Skäl att det inte gick sparas på den trötta annonsen.
export async function tryPropose(ctx) {
  try {
    return await proposeFromVariant(ctx);
  } catch (e) {
    if (!(e instanceof SwapRejected)) throw e;
    await ctx.supabase.from('ad_fatigue').update({ status_note: `Förslag kunde inte skapas: ${e.message}`, updated_at: new Date().toISOString() }).eq('id', ctx.review.fatigue_id);
    return { rejected: e.message };
  }
}

// En variant som inte längre är godkänd får inget väntande förslag kvar.
export async function supersedeForVariant(supabase, reviewId, now = new Date()) {
  const { data } = await supabase.from('proposals').update({ status: 'superseded', status_reason: 'Varianten är inte längre godkänd i granskningen.', updated_at: now.toISOString() })
    .eq('type', 'creative_swap').eq('status', 'pending').eq('meta->>variant_review_id', String(reviewId)).select('id');
  return (data || []).length;
}

// ── 4. Efter bytet ────────────────────────────────────────────────────────
// Ett genomfört byte: den trötta annonsen är ersatt av den nya.
export async function markSwapDone(supabase, proposal, now = new Date()) {
  if (proposal?.type !== 'creative_swap' || proposal.kind !== 'change' || proposal.status !== 'done') return false;
  const { data } = await supabase.from('ad_fatigue').update({
    status: 'ersatt', new_ad_id: proposal.meta?.new_ad_id || null, swapped_at: now.toISOString(), status_note: null, updated_at: now.toISOString(),
  }).eq('id', proposal.meta?.fatigue_id).eq('status', 'trott').select('id');
  return (data || []).length > 0;
}

// Ångrat byte: den gamla annonsen är tillbaka och fortfarande trött.
export async function markSwapUndone(supabase, proposal, now = new Date()) {
  if (proposal?.type !== 'creative_swap' || proposal.kind !== 'undo' || proposal.status !== 'done') return false;
  const { data } = await supabase.from('ad_fatigue').update({ status: 'trott', status_note: 'Bytet ångrades.', swapped_at: null, updated_at: now.toISOString() })
    .eq('status', 'ersatt').eq('ad_id', proposal.object_id).eq('user_id', proposal.user_id).select('id');
  return (data || []).length > 0;
}

/**
 * Jämför den nya annonsen (sedan bytet) med den gamla annonsens sista vecka före bytet.
 * Visas i veckovyn (Modul C). Bara egen data från Meta.
 */
export async function updateFollowup({ supabase, fatigue, tokens, now = new Date(), get }) {
  if (!fatigue.new_ad_id || !fatigue.swapped_at) return null;
  const since = stockholmDate(new Date(fatigue.swapped_at));
  const until = addDays(stockholmDate(now), -1);
  if (until < since) return null;
  const settings = await fatigueSettings(supabase, fatigue.user_id);
  const resultTypes = await resultTypesFor(supabase, fatigue.user_id);
  const row = await withTokens(tokens, (token) => adPeriod(fatigue.new_ad_id, since, until, token, get));
  const after = row ? aggregate([weekFromInsight({ ...row, date_start: since }, resultTypes)]) : null;
  const followup = { since, until, before: fatigue.metrics?.recent || null, after, ...compareFollowup(fatigue.metrics?.recent, after, settings) };
  must(await supabase.from('ad_fatigue').update({ followup, followup_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', fatigue.id), 'ad_fatigue');
  return followup;
}
