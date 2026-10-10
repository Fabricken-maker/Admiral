/**
 * Admiral Modul D — skrivgrinden. ENDA stället i Admiral som skriver till Meta.
 * (test/approvals.test.mjs kontrollerar att ingen annan fil gör POST mot graph.facebook.com.)
 *
 * En skrivning sker bara om ALLT stämmer:
 *  1. Förslaget har ett registrerat godkännande (decision = approve) som gäller just det förslaget.
 *  2. Kunden har skrivbehörighet, nödstoppet är av (kontrolleras två gånger, sista gången precis
 *     före anropet) och kontot finns bland kundens skrivbara konton.
 *  3. Godkännandet har inte gått ut och har inte använts (det tas atomärt: används en gång).
 *  4. Gränserna per åtgärd, per period och mot månadstaket håller (inte för Ångra).
 *  5. Värdet i Meta är fortfarande det som förslaget utgick från.
 *  6. Byte av annons (creative_swap): varianten är fortfarande Godkänd i granskningen (Modul B).
 *     Den nya annonsen skapas PAUSAD, statusen läses tillbaka, och först därefter startas den.
 * Före skrivningen sparas värdet i meta_write_log. Efter skrivningen läses värdet tillbaka
 * och jämförs: Genomförd, Verifierar (Meta har inte hunnit uppdatera) eller Misslyckades.
 */
import { GRAPH, graphGet, withTokens, MetaError, metaMessage } from './meta-graph.js';
import { checkLimits, monthlyDelta, normalizeWriteSettings, sameValue, isBudgetType, describe, confirmationText } from './proposals.js';
import { NEW_AD, creativeParams, withNewAdId } from './creative-swap.js';

export class WriteBlocked extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WriteBlocked';
    this.code = code;
  }
}

const TIMEOUT_MS = 12000;

async function graphPost(path, params, token, fetchImpl) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  body.set('access_token', token);
  const res = await fetchImpl(`${GRAPH}/${path}`, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = await res.json();
  if (json.error) throw new MetaError(`Meta: ${metaMessage(json.error)}`, json.error.code);
  return json;
}

// ── Läs och skriv värden enligt värdemodellen ─────────────────────────────
export async function readValue(p, token, fetchImpl = fetch) {
  if (p.type === 'creative_swap') {
    const ads = {};
    const creative_ids = {};
    for (const id of Object.keys(p.proposed_value.ads)) {
      if (id === NEW_AD) continue;
      const o = await graphGet(id, { fields: 'status,creative{id}' }, token, fetchImpl);
      ads[id] = o.status;
      creative_ids[id] = o.creative?.id || null;
    }
    return { ads, creative_ids };
  }
  if (p.type === 'ad_status') {
    const o = await graphGet(p.object_id, { fields: 'status' }, token, fetchImpl);
    return { status: o.status };
  }
  const budgets = {};
  for (const id of Object.keys(p.proposed_value.budgets)) {
    const o = await graphGet(id, { fields: 'daily_budget' }, token, fetchImpl);
    budgets[id] = Number(o.daily_budget || 0);
  }
  return { budgets };
}

// Sätter status på flera annonser. Start först, paus sist, så att inget glapp uppstår.
async function setStatuses(ads, token, fetchImpl) {
  const request = {};
  const response = {};
  const order = Object.entries(ads).sort(([, a], [, b]) => (a === 'ACTIVE' ? -1 : 1) - (b === 'ACTIVE' ? -1 : 1));
  for (const [id, status] of order) {
    request[id] = { status };
    response[id] = await graphPost(id, { status }, token, fetchImpl);
  }
  return { request, response };
}

/**
 * Byte av annons: (1) ladda upp bilden om varianten har en ny bild, (2) skapa annonsdesignen,
 * (3) skapa annonsen PAUSAD, (4) läs tillbaka att den är pausad, (5) kontrollera nödstoppet igen,
 * (6) starta den nya annonsen och pausa den gamla.
 * Misslyckas något efter steg 3 ligger den nya annonsen kvar pausad, och felet sparas med dess id.
 */
async function swapCreative(p, token, fetchImpl, { repo, log }) {
  const spec = p.meta.swap;
  const oldId = p.object_id;
  const partial = { created: {} };
  const fail = (e) => { e.partial = partial; return e; };
  try {
    let imageHash = null;
    let thumbnailUrl = null;
    if (spec.media.kind === 'upload') {
      const bytes = await repo.getImageBytes(spec.media.image_path);
      const up = await graphPost(`${p.ad_account_id}/adimages`, { bytes: bytes.toString('base64') }, token, fetchImpl);
      imageHash = Object.values(up.images || {})[0]?.hash;
      if (!imageHash) throw new Error('Meta tog inte emot bilden.');
      partial.created.image_hash = imageHash;
    } else if (spec.media.kind === 'video' && !spec.thumbnail_hash) {
      const v = await graphGet(spec.media.video_id, { fields: 'picture,thumbnails{uri,is_preferred}' }, token, fetchImpl);
      thumbnailUrl = (v.thumbnails?.data || []).find((t) => t.is_preferred)?.uri || v.picture || null;
    }

    let creative;
    try {
      creative = await graphPost(`${p.ad_account_id}/adcreatives`, creativeParams(spec, { imageHash, thumbnailUrl }), token, fetchImpl);
    } catch (e) {
      // Meta tar inte alltid emot inställningarna för Advantage+-förbättringar: försök utan dem.
      if (!spec.features || !/degrees_of_freedom|creative_features|enroll/i.test(e.message)) throw e;
      creative = await graphPost(`${p.ad_account_id}/adcreatives`, creativeParams(spec, { imageHash, thumbnailUrl, withFeatures: false }), token, fetchImpl);
      partial.created.features_dropped = true;
    }
    partial.created.creative_id = creative.id;

    const ad = await graphPost(`${p.ad_account_id}/ads`, {
      name: spec.ad_name, adset_id: spec.adset_id, creative: { creative_id: creative.id }, status: 'PAUSED',
    }, token, fetchImpl);
    partial.created.ad_id = ad.id;
    p.proposed_value = withNewAdId(p.proposed_value, ad.id);
    p.meta = { ...p.meta, new_ad_id: ad.id, creative_id: creative.id };
    await repo.updateProposal(p.id, { proposed_value: p.proposed_value, meta: p.meta });

    const created = await graphGet(ad.id, { fields: 'status' }, token, fetchImpl);
    partial.created.status = created.status;
    if (created.status !== 'PAUSED') throw new Error(`Den nya annonsen skapades med status ${created.status}, inte pausad.`);
    await repo.updateWriteLog(log.id, { before: { ...log.before, ads: { ...log.before.ads, [ad.id]: 'PAUSED' } } });

    const latest = normalizeWriteSettings(await repo.getWriteSettings(p.user_id));
    if (latest.kill_switch || !latest.writes_enabled) throw new Error('Nödstoppet slogs på. Den nya annonsen ligger kvar pausad.');

    const sent = await setStatuses({ [ad.id]: 'ACTIVE', [oldId]: 'PAUSED' }, token, fetchImpl);
    return { request: { created: partial.created, ...sent.request }, response: sent.response };
  } catch (e) {
    throw fail(e);
  }
}

export const isApprovedVariant = (r) => Boolean(r && r.fatigue_id && r.status === 'klar' && (r.decided_verdict || r.verdict) === 'godkand');

async function writeValue(p, token, fetchImpl, ctx) {
  if (p.type === 'creative_swap') {
    return p.kind === 'undo' ? setStatuses(p.proposed_value.ads, token, fetchImpl) : swapCreative(p, token, fetchImpl, ctx);
  }
  if (p.type === 'ad_status') {
    const r = await graphPost(p.object_id, { status: p.proposed_value.status }, token, fetchImpl);
    return { request: { [p.object_id]: { status: p.proposed_value.status } }, response: r };
  }
  if (p.type === 'apply_recommendation') {
    const params = { recommendation_signature: p.meta.recommendation_signature, extra_data: p.meta.extra_data || {} };
    const r = await graphPost(`${p.ad_account_id}/recommendations`, params, token, fetchImpl);
    return { request: { [`${p.ad_account_id}/recommendations`]: params }, response: r };
  }
  const request = {};
  const response = {};
  for (const [id, cents] of Object.entries(p.proposed_value.budgets)) {
    request[id] = { daily_budget: Number(cents) };
    response[id] = await graphPost(id, { daily_budget: Number(cents) }, token, fetchImpl);
  }
  return { request, response };
}

// Levererar objektet, och vad är kontots samlade dagsbudget för det som levererar? (för månadstaket)
export async function deliveryInfo(p, token, fetchImpl = fetch) {
  if (!isBudgetType(p.type)) return null;
  const ids = Object.keys(p.proposed_value.budgets);
  const statuses = await Promise.all(ids.map((id) => graphGet(id, { fields: 'effective_status' }, token, fetchImpl)));
  const delivering = statuses.some((o) => o.effective_status === 'ACTIVE');
  let accountDailyCents = 0;
  for (const level of ['adsets', 'campaigns']) {
    const res = await graphGet(`${p.ad_account_id}/${level}`, {
      fields: 'daily_budget,effective_status',
      filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }],
      limit: 500,
    }, token, fetchImpl);
    for (const o of res.data || []) accountDailyCents += Number(o.daily_budget || 0);
  }
  return { delivering, accountDailyCents };
}

async function periodWrites(repo, userId, settings, now) {
  const since = new Date(now.getTime() - settings.period_days * 86400000).toISOString();
  const rows = await repo.writesSince(userId, since);
  return rows.filter((w) => w.status !== 'failed' && w.action === 'apply');
}

// ── Grinden ───────────────────────────────────────────────────────────────
export async function executeApproved({ repo, proposalId, tokens, now = new Date(), fetchImpl = fetch }) {
  const p = await repo.getProposal(proposalId);
  if (!p) throw new WriteBlocked('not_found', 'Förslaget finns inte.');
  const a = await repo.getApproval(proposalId);
  if (!a || a.decision !== 'approve' || a.proposal_id !== p.id) {
    throw new WriteBlocked('no_approval', 'Det finns inget registrerat godkännande för den här åtgärden.');
  }
  if (p.status !== 'approved') throw new WriteBlocked('wrong_status', `Förslaget har status ${p.status} och kan inte genomföras.`);

  const settings = normalizeWriteSettings(await repo.getWriteSettings(p.user_id));
  if (settings.kill_switch) throw new WriteBlocked('kill_switch', 'Alla ändringar i Meta är stoppade för kunden (nödstopp).');
  if (!settings.writes_enabled) throw new WriteBlocked('writes_disabled', 'Kunden har inte gett Admiral skrivbehörighet.');
  if (!settings.ad_account_ids.includes(p.ad_account_id)) throw new WriteBlocked('account', 'Annonskontot är inte godkänt för ändringar.');
  if (a.valid_until && now > new Date(a.valid_until)) throw new WriteBlocked('approval_expired', 'Godkännandet har gått ut.');
  // En variant som inte (längre) är Godkänd i granskningen publiceras aldrig.
  if (p.type === 'creative_swap' && p.kind !== 'undo' && !isApprovedVariant(await repo.getVariantReview(p.meta?.variant_review_id))) {
    await repo.updateProposal(p.id, { status: 'failed', status_reason: 'Varianten är inte godkänd i granskningen.' });
    throw new WriteBlocked('variant_not_approved', 'Varianten är inte godkänd i granskningen.');
  }

  return withTokens(tokens, async (token) => {
    if (p.kind !== 'undo') {
      const limits = checkLimits({
        type: p.type, kind: p.kind, current: p.current_value, proposed: p.proposed_value, settings,
        periodWrites: await periodWrites(repo, p.user_id, settings, now),
        delivery: await deliveryInfo(p, token, fetchImpl),
      });
      if (!limits.ok) {
        await repo.updateProposal(p.id, { status: 'failed', status_reason: limits.errors.join(' ') });
        throw new WriteBlocked('limit', limits.errors.join(' '));
      }
    }

    // Godkännandet används en gång: den som tar det först får skriva.
    if (!(await repo.claimApproval(a.id, now.toISOString()))) {
      throw new WriteBlocked('approval_used', 'Godkännandet har redan använts.');
    }

    const before = await readValue(p, token, fetchImpl);
    if (!sameValue(p.type, before, p.current_value)) {
      await repo.updateProposal(p.id, { status: 'failed', status_reason: 'Värdet i Meta har ändrats sedan förslaget skapades.' });
      throw new WriteBlocked('stale', 'Värdet i Meta har ändrats sedan förslaget skapades. Ett nytt förslag behövs.');
    }

    // Sista kontrollen av nödstoppet, precis före anropet.
    const latest = normalizeWriteSettings(await repo.getWriteSettings(p.user_id));
    if (latest.kill_switch || !latest.writes_enabled) {
      await repo.updateProposal(p.id, { status: 'failed', status_reason: 'Nödstoppet slogs på innan ändringen skickades.' });
      throw new WriteBlocked('kill_switch', 'Alla ändringar i Meta är stoppade för kunden (nödstopp).');
    }

    const log = await repo.insertWriteLog({
      proposal_id: p.id, approval_id: a.id, user_id: p.user_id, actor_id: a.decided_by, on_behalf: a.on_behalf,
      ad_account_id: p.ad_account_id, object_id: p.object_id, action: p.kind === 'undo' ? 'undo' : 'apply',
      before, request: { pending: true, monthly_delta_sek: monthlyDelta(p.type, before, p.proposed_value) }, status: 'verifying',
    });
    await repo.updateProposal(p.id, { status: 'verifying' });

    let sent;
    try {
      sent = await writeValue(p, token, fetchImpl, { repo, log });
    } catch (e) {
      await repo.updateWriteLog(log.id, { status: 'failed', error: e.message, request: { monthly_delta_sek: 0, ...(e.partial || {}) } });
      await repo.updateProposal(p.id, { status: 'failed', status_reason: e.message });
      return { status: 'failed', write_id: log.id, error: e.message };
    }

    const after = await readValue(p, token, fetchImpl).catch(() => null);
    const ok = after && sameValue(p.type, after, p.proposed_value);
    const status = ok ? 'done' : 'verifying';
    await repo.updateWriteLog(log.id, {
      request: { ...sent.request, monthly_delta_sek: monthlyDelta(p.type, before, p.proposed_value) },
      response: sent.response, after, status, verified_at: ok ? now.toISOString() : null,
    });
    await repo.updateProposal(p.id, { status, status_reason: ok ? null : 'Meta har tagit emot ändringen men visar ännu inte det nya värdet.' });
    return { status, write_id: log.id, before, after };
  });
}

// Läs tillbaka en skrivning som ännu inte bekräftats (körs av proposals-maintenance).
export async function reverify({ repo, writeLog, tokens, now = new Date(), fetchImpl = fetch }) {
  const p = await repo.getProposal(writeLog.proposal_id);
  const after = await withTokens(tokens, (token) => readValue(p, token, fetchImpl));
  if (sameValue(p.type, after, p.proposed_value)) {
    await repo.updateWriteLog(writeLog.id, { after, status: 'done', verified_at: now.toISOString() });
    await repo.updateProposal(p.id, { status: 'done', status_reason: null });
    return 'done';
  }
  if (sameValue(p.type, after, writeLog.before)) {
    await repo.updateWriteLog(writeLog.id, { after, status: 'failed', error: 'Ändringen syns inte i Meta.' });
    await repo.updateProposal(p.id, { status: 'failed', status_reason: 'Ändringen syns inte i Meta.' });
    return 'failed';
  }
  return 'verifying';
}

/**
 * Ångra en genomförd skrivning: ett nytt förslag (kind 'undo') med det sparade före-värdet,
 * godkänt av den som tryckte Ångra, genom samma grind.
 */
export async function createUndo({ repo, writeId, actorId, onBehalf, now = new Date() }) {
  const w = await repo.getWriteLog(writeId);
  if (!w || w.status !== 'done') throw new WriteBlocked('not_undoable', 'Bara genomförda ändringar kan ångras.');
  const latest = await repo.latestWriteForObject(w.object_id);
  if (latest && latest.id !== w.id) throw new WriteBlocked('not_latest', 'En senare ändring har gjorts på samma objekt. Ångra den först.');
  const orig = await repo.getProposal(w.proposal_id);
  if (orig.type === 'apply_recommendation' || orig.type === 'budget_change') {
    if (!w.before?.budgets) throw new WriteBlocked('not_undoable', 'Före-värdet saknas.');
  }
  if (orig.type === 'creative_swap' && Object.keys(w.before?.ads || {}).length < 2) throw new WriteBlocked('not_undoable', 'Den nya annonsen saknas i loggen.');
  const type = orig.type === 'apply_recommendation' ? 'budget_change' : orig.type;
  const p = {
    user_id: w.user_id, ad_account_id: w.ad_account_id, type, kind: 'undo', undo_of_write_id: w.id,
    object_type: orig.object_type, object_id: orig.object_id, object_name: orig.object_name,
    current_value: w.after, proposed_value: w.before,
    meta: orig.type === 'creative_swap' ? { variant_label: orig.meta?.variant_label, new_ad_id: orig.meta?.new_ad_id } : {},
    reason: `Återställer ändringen från ${new Date(w.created_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' })}.`,
    reason_data: {}, expected_outcome: {}, source: 'undo', created_by: actorId,
    valid_until: new Date(now.getTime() + 15 * 60000).toISOString(),
  };
  p.confirmation_text = `Ångra: ${confirmationText(p)}`;
  p.status = 'approved';
  const created = await repo.insertProposal(p);
  await repo.insertApproval({
    proposal_id: created.id, decision: 'approve', decided_by: actorId, on_behalf: onBehalf,
    confirmation_text: p.confirmation_text, valid_until: p.valid_until,
  });
  return { ...created, title: describe(created) };
}
