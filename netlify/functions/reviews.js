/**
 * Admiral Modul B — granskning av annonsmaterial
 *
 * GET  /api/reviews?customers=1           → kunder att välja mellan
 * GET  /api/reviews?user_id=              → senaste granskningen per annons och bild/video
 * GET  /api/reviews?id=                   → en granskning med bild, original och övriga bilder i annonsen
 * POST /api/reviews { action: 'scan', user_id }                         → granska kundens aktiva annonser i Meta
 * POST /api/reviews { action: 'upload', user_id, image_base64, texts, original_review_id? } → granska en ny bild
 * POST /api/reviews { action: 'decide', id, verdict, note }             → Fabrickens beslut (godkand/underkand/null)
 * POST /api/reviews { action: 'rerun', id }                             → granska igen (t.ex. efter ändrad profil)
 * POST /api/reviews { action: 'dismiss_fatigue', id }                   → Modul E: avfärda en trött annons
 * POST /api/reviews { action: 'propose_variant', id }                   → Modul E: gör förslag av en godkänd variant
 * Uppladdning med fatigue_id blir en variant till den trötta annonsen (Modul E).
 *
 * Bara Fabricken (admin) i första versionen. Läser från Meta, skriver aldrig dit.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { withTokens } from './lib/meta-graph.js';
import { collectAssets } from './lib/review-meta.js';
import { createReviewStore, latestPerAsset, effectiveVerdict } from './lib/review-store.js';
import { storeImage, MAX_IMAGE_BYTES } from './lib/review-run.js';
import { rankedFindings, FEATURE_LABELS } from './lib/review-rules.js';
import { visionAvailable } from './lib/review-vision.js';
import { triggerReviewRunner } from './lib/internal-auth.js';
import { createRepo } from './lib/write-repo.js';
import { tryPropose, supersedeForVariant, nextLabel } from './lib/fatigue-flow.js';
import { fatigueSummary } from './lib/fatigue.js';
import { isApprovedVariant } from './lib/meta-write.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const originOf = (event) => {
  try { return new URL(event.rawUrl).origin; } catch { return process.env.DEPLOY_URL || process.env.URL || null; }
};

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, POST, OPTIONS');
  const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  let actor;
  try {
    const p = jwt.verify((event.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
    actor = { id: p.id, isAdmin: p.email === ADMIN_EMAIL };
  } catch {
    return json(401, { error: 'Unauthorized' });
  }
  if (!actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });

  const store = createReviewStore(supabase);
  const q = event.queryStringParameters || {};

  try {
    if (event.httpMethod === 'GET') {
      if (q.customers) return json(200, { customers: await store.customers() });
      if (q.id) {
        const r = await store.getReview(Number(q.id));
        if (!r) return json(404, { error: 'Granskningen finns inte' });
        return json(200, await detail(store, r));
      }
      const userId = Number(q.user_id || actor.id);
      return json(200, await overview(store, userId));
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');

    if (body.action === 'scan') {
      const userId = Number(body.user_id);
      if (!userId) return json(400, { error: 'Kund saknas' });
      const profile = await store.getProfile(userId);
      const accounts = await store.accountsFor(userId, profile);
      if (!accounts.length) return json(400, { error: 'Kunden har inget annonskonto kopplat.' });
      const tokens = await tokensForCustomer(supabase, userId);
      if (!tokens.length) return json(400, { error: 'Det finns ingen giltig Meta-koppling för kunden.' });
      let found = 0;
      const ids = [];
      for (const account of accounts) {
        const items = await withTokens(tokens, (token) => collectAssets(account, token));
        found += items.length;
        ids.push(...await store.enqueue(items.map((i) => ({ ...i, user_id: userId, source: 'meta', created_by: actor.id }))));
      }
      if (ids.length) await triggerReviewRunner(originOf(event));
      return json(200, { found, queued: ids.length });
    }

    if (body.action === 'upload') {
      const userId = Number(body.user_id);
      if (!userId) return json(400, { error: 'Kund saknas' });
      const buf = Buffer.from(String(body.image_base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
      if (!buf.length) return json(400, { error: 'Bilden saknas' });
      if (buf.length > MAX_IMAGE_BYTES) return json(400, { error: 'Bilden är för stor' });
      let stored;
      try { stored = await storeImage(store, userId, buf); } catch (e) { return json(400, { error: e.message }); }
      const texts = {
        bodies: [String(body.texts?.body || '').trim()].filter(Boolean),
        titles: [String(body.texts?.title || '').trim()].filter(Boolean),
        descriptions: [String(body.texts?.description || '').trim()].filter(Boolean),
        cta: [],
      };
      // Modul E: en variant till en trött annons jämförs med annonsens bild och får nästa bokstav.
      let fatigue = null;
      let label = null;
      if (body.fatigue_id) {
        const { data: f } = await supabase.from('ad_fatigue').select('*').eq('id', Number(body.fatigue_id)).maybeSingle();
        if (!f || f.user_id !== userId || f.status !== 'trott') return json(400, { error: 'Den trötta annonsen finns inte' });
        fatigue = f;
        label = await nextLabel(supabase, f.id);
        if (!label) return json(400, { error: 'Annonsen har redan max antal varianter.' });
      }
      const originalId = body.original_review_id ? Number(body.original_review_id) : fatigue?.original_review_id || null;
      if (originalId) {
        const orig = await store.getReview(originalId);
        if (!orig || orig.user_id !== userId) return json(400, { error: 'Originalet finns inte för den här kunden' });
        if (fatigue && !texts.bodies.length) Object.assign(texts, { bodies: orig.texts?.bodies?.slice(0, 1) || [], titles: orig.texts?.titles?.slice(0, 1) || [], descriptions: orig.texts?.descriptions?.slice(0, 1) || [] });
      }
      const assetKey = `upl:${stored.hash}`;
      const contentKey = crypto.createHash('sha256').update(JSON.stringify({ assetKey, texts, originalId, fatigue: fatigue?.id || null })).digest('hex');
      const [id] = await store.enqueue([{
        user_id: userId, source: 'uppladdad',
        ad_name: fatigue ? `${fatigue.ad_name || 'Annons'} – variant ${label}` : String(body.name || '').trim().slice(0, 120) || 'Uppladdad bild',
        ad_account_id: fatigue?.ad_account_id || null, campaign_name: fatigue?.campaign_name || null,
        asset_key: assetKey, asset_type: 'bild', content_key: contentKey, original_review_id: originalId,
        image_path: stored.path, image_sha256: stored.hash, texts, created_by: actor.id,
        fatigue_id: fatigue?.id || null, variant_label: label,
      }]);
      if (!id) {
        const { data } = await supabase.from('creative_reviews').select('id').eq('user_id', userId).eq('asset_key', assetKey).eq('content_key', contentKey).maybeSingle();
        return json(200, { id: data?.id, already: true });
      }
      await triggerReviewRunner(originOf(event));
      return json(201, { id });
    }

    if (body.action === 'decide') {
      const r = await store.getReview(Number(body.id));
      if (!r) return json(404, { error: 'Granskningen finns inte' });
      const verdict = body.verdict === null ? null : body.verdict;
      if (verdict !== null && !['godkand', 'underkand'].includes(verdict)) return json(400, { error: 'Ogiltigt beslut' });
      await store.updateReview(r.id, {
        decided_verdict: verdict,
        decided_by: verdict ? actor.id : null,
        decided_at: verdict ? new Date().toISOString() : null,
        decision_note: verdict ? String(body.note || '').trim().slice(0, 500) || null : null,
      });
      const updated = await store.getReview(r.id);
      // Modul E: en godkänd variant blir förslag, en som inte längre är godkänd förlorar sitt förslag.
      if (updated.fatigue_id) {
        if (isApprovedVariant(updated)) await tryPropose({ supabase, repo: createRepo(supabase), store, review: updated, tokens: await tokensForCustomer(supabase, updated.user_id) });
        else await supersedeForVariant(supabase, updated.id);
      }
      return json(200, await detail(store, updated));
    }

    if (body.action === 'dismiss_fatigue') {
      const { data: f } = await supabase.from('ad_fatigue').select('id, status, proposal_id').eq('id', Number(body.id)).maybeSingle();
      if (!f || f.status !== 'trott') return json(404, { error: 'Den trötta annonsen finns inte' });
      await supabase.from('ad_fatigue').update({ status: 'avfardad', dismissed_by: actor.id, updated_at: new Date().toISOString() }).eq('id', f.id);
      if (f.proposal_id) await supabase.from('proposals').update({ status: 'superseded', status_reason: 'Fabricken avfärdade tröttheten.', updated_at: new Date().toISOString() }).eq('id', f.proposal_id).eq('status', 'pending');
      return json(200, { id: f.id, status: 'avfardad' });
    }

    if (body.action === 'propose_variant') {
      const r = await store.getReview(Number(body.id));
      if (!r?.fatigue_id) return json(404, { error: 'Varianten finns inte' });
      if (!isApprovedVariant(r)) return json(400, { error: 'Bara godkända varianter kan bli förslag.' });
      const result = await tryPropose({ supabase, repo: createRepo(supabase), store, review: r, tokens: await tokensForCustomer(supabase, r.user_id), replace: true });
      if (result.rejected) return json(400, { error: result.rejected });
      return json(200, { proposal_id: result.proposal?.id || result.proposal_id || null, skipped: result.skipped || null });
    }

    if (body.action === 'rerun') {
      const r = await store.getReview(Number(body.id));
      if (!r) return json(404, { error: 'Granskningen finns inte' });
      if (r.status === 'analyserar') return json(409, { error: 'Granskningen pågår redan' });
      await store.updateReview(r.id, { status: 'koar', attempts: 0, error: null });
      if (r.fatigue_id) await supersedeForVariant(supabase, r.id);
      await triggerReviewRunner(originOf(event));
      return json(200, { id: r.id, status: 'koar' });
    }

    return json(400, { error: 'Okänd åtgärd' });
  } catch (e) {
    console.error('[reviews]', e.message);
    return json(500, { error: 'Något gick fel. Försök igen.' });
  }
};

async function overview(store, userId) {
  const rows = latestPerAsset(await store.listReviews(userId));
  const urls = await store.signedUrls(rows.map((r) => r.image_path));
  const profile = await store.getProfile(userId);
  const counts = { godkand: 0, granska: 0, underkand: 0, pagar: 0, fel: 0 };
  for (const r of rows) {
    if (r.status === 'koar' || r.status === 'analyserar') counts.pagar += 1;
    else if (r.status === 'fel') counts.fel += 1;
    else counts[effectiveVerdict(r)] += 1;
  }
  return {
    user_id: userId,
    profile_exists: profile.exists,
    ai_active: visionAvailable(),
    counts,
    reviews: rows.map((r) => ({ ...publicRow(r), image_url: urls[r.image_path] || null })),
    fatigue: await fatigueList(store, userId),
  };
}

// Modul E: trötta annonser (öppna och de senaste 8 veckornas byten) med varianter och förslag.
const PROPOSAL_LABEL = { pending: 'Väntar på godkännande', approved: 'Godkänd', verifying: 'Verifierar', done: 'Genomförd', failed: 'Misslyckades', rejected: 'Avstådd', expired: 'Gick ut', superseded: 'Ersatt' };
async function fatigueList(store, userId) {
  const since = new Date(Date.now() - 56 * 86400000).toISOString();
  const { data: rows } = await supabase.from('ad_fatigue').select('*').eq('user_id', userId)
    .or(`status.eq.trott,updated_at.gte.${since}`).order('detected_at', { ascending: false }).limit(20);
  if (!rows?.length) return [];
  const ids = rows.map((f) => f.id);
  const { data: variants } = await supabase.from('creative_reviews')
    .select('id, fatigue_id, variant_label, source, status, verdict, decided_verdict, image_path, texts').in('fatigue_id', ids).order('variant_label');
  const propIds = rows.map((f) => f.proposal_id).filter(Boolean);
  const { data: props } = propIds.length ? await supabase.from('proposals').select('id, status, status_reason').in('id', propIds) : { data: [] };
  const originals = await Promise.all(rows.map((f) => (f.original_review_id ? store.getReview(f.original_review_id) : null)));
  const urls = await store.signedUrls([...(variants || []).map((v) => v.image_path), ...originals.map((o) => o?.image_path)]);
  return rows.map((f, i) => {
    const prop = (props || []).find((p) => p.id === f.proposal_id);
    return {
      id: f.id, ad_id: f.ad_id, ad_name: f.ad_name, campaign_name: f.campaign_name, status: f.status, status_note: f.status_note,
      summary: f.metrics?.recent ? fatigueSummary(f.metrics) : null, week_start: f.week_start, detected_at: f.detected_at,
      original: originals[i] ? { id: originals[i].id, image_url: urls[originals[i].image_path] || null } : null,
      variants: (variants || []).filter((v) => v.fatigue_id === f.id).map((v) => ({
        id: v.id, label: v.variant_label, source: v.source, status: v.status,
        verdict: v.status === 'klar' ? effectiveVerdict(v) : null, image_url: urls[v.image_path] || null,
        title: v.texts?.titles?.[0] || null,
      })),
      proposal: prop ? { id: prop.id, status: prop.status, label: PROPOSAL_LABEL[prop.status] || prop.status, reason: prop.status_reason } : null,
      new_ad_id: f.new_ad_id, swapped_at: f.swapped_at, followup: f.followup,
    };
  });
}

async function detail(store, r) {
  const siblings = r.ad_id
    ? latestPerAsset((await store.listReviews(r.user_id)).filter((x) => x.ad_id === r.ad_id)).filter((x) => x.asset_key !== r.asset_key)
    : [];
  const original = r.original_review_id ? await store.getReview(r.original_review_id) : null;
  const history = (await store.listReviews(r.user_id)).filter((x) => x.id !== r.id && x.asset_key === r.asset_key && x.ad_id === r.ad_id);
  const urls = await store.signedUrls([r.image_path, original?.image_path, ...siblings.map((s) => s.image_path)]);
  return {
    review: {
      ...publicRow(r),
      image_url: urls[r.image_path] || null,
      width: r.width, height: r.height,
      texts: r.texts, checks: r.checks, findings: rankedFindings(r.checks || []),
      features: r.features, error: r.error, ai_model: r.ai_model,
      decision_note: r.decision_note, decided_at: r.decided_at,
    },
    original: original ? { id: original.id, ad_name: original.ad_name, image_url: urls[original.image_path] || null, verdict: effectiveVerdict(original) } : null,
    siblings: siblings.map((s) => ({ id: s.id, asset_type: s.asset_type, verdict: effectiveVerdict(s), status: s.status, image_url: urls[s.image_path] || null })),
    history: history.map((h) => ({ id: h.id, created_at: h.created_at, verdict: effectiveVerdict(h), status: h.status })),
    feature_labels: FEATURE_LABELS,
  };
}

function publicRow(r) {
  return {
    id: r.id, user_id: r.user_id, ad_id: r.ad_id, ad_name: r.ad_name, ad_status: r.ad_status, campaign_name: r.campaign_name,
    asset_type: r.asset_type, source: r.source, status: r.status,
    verdict: r.verdict, verdict_reason: r.verdict_reason, decided_verdict: r.decided_verdict,
    effective_verdict: effectiveVerdict(r), original_review_id: r.original_review_id,
    fatigue_id: r.fatigue_id || null, variant_label: r.variant_label || null,
    created_at: r.created_at, analyzed_at: r.analyzed_at,
  };
}

export default modern(handler);
