/**
 * Admiral Modul D — förslag och godkännanden
 *
 * GET  /api/proposals[?user_id=]              → väntande förslag + senaste ändringar (admin: valfri kund)
 * GET  /api/proposals?customers=1             → (admin) kunder med skrivinställningar
 * POST /api/proposals                         → (admin) skapa förslag { user_id, type, object_type, object_id, daily_budget_sek | status }
 * POST /api/proposals/:id/approve             → godkänn { confirmation_text } och genomför
 * POST /api/proposals/:id/reject              → avstå
 * POST /api/proposals/writes/:writeId/undo    → ångra en genomförd ändring
 *
 * Kunden godkänner, avstår och ångrar sina egna förslag. Fabricken (admin) kan göra det å
 * kundens vägnar och loggas då som sådan. Kunden kan inte skapa förslag.
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { createRepo } from './lib/write-repo.js';
import { tokensForCustomer } from './lib/token-store.js';
import { buildProposal, ProposalRejected } from './lib/build-proposal.js';
import { executeApproved, createUndo, WriteBlocked } from './lib/meta-write.js';
import { describe, normalizeWriteSettings, PUBLIC_STATUS } from './lib/proposals.js';
import { isApprovedVariant } from './lib/meta-write.js';
import { markSwapDone, markSwapUndone } from './lib/fatigue-flow.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';
const UNDO_DAYS = 30;

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

  const repo = createRepo(supabase);
  const q = event.queryStringParameters || {};
  const route = (event.path || '').replace(/^.*\/proposals\/?/, '').split('/').filter(Boolean);

  try {
    if (event.httpMethod === 'GET') {
      if (q.customers) {
        if (!actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });
        const { data } = await supabase.from('write_settings').select('user_id, users!write_settings_user_id_fkey!inner(email, company_name)').order('user_id');
        return json(200, { customers: (data || []).map((c) => ({ user_id: c.user_id, name: c.users.company_name ? `${c.users.company_name} · ${c.users.email}` : c.users.email })) });
      }
      const customerId = q.user_id ? Number(q.user_id) : actor.id;
      if (customerId !== actor.id && !actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });
      return json(200, await listForCustomer(customerId, actor));
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');

    // Skapa förslag (bara Fabricken/admin)
    if (route.length === 0) {
      if (!actor.isAdmin) return json(403, { error: 'Kunder kan inte skapa egna åtgärder.' });
      const userId = Number(body.user_id || actor.id);
      const tokens = await tokensForCustomer(supabase, userId);
      try {
        const p = await buildProposal({
          supabase, repo, tokens,
          spec: {
            userId, type: body.type, objectType: body.object_type, objectId: String(body.object_id || ''),
            dailyBudgetSek: body.daily_budget_sek, status: body.status, source: 'admin', createdBy: actor.id,
          },
        });
        return json(201, { proposal: publicProposal(p) });
      } catch (e) {
        if (e instanceof ProposalRejected) return json(400, { error: e.message, errors: e.errors });
        throw e;
      }
    }

    // Ångra
    if (route[0] === 'writes' && route[2] === 'undo') {
      const w = await repo.getWriteLog(Number(route[1]));
      if (!w) return json(404, { error: 'Ändringen finns inte.' });
      if (w.user_id !== actor.id && !actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });
      if (Date.now() - new Date(w.created_at) > UNDO_DAYS * 86400000) return json(409, { error: `Ändringar kan ångras i ${UNDO_DAYS} dagar.` });
      const undo = await createUndo({ repo, writeId: w.id, actorId: actor.id, onBehalf: w.user_id !== actor.id });
      return json(200, await runGate(repo, undo.id, w.user_id));
    }

    const proposal = await repo.getProposal(Number(route[0]));
    if (!proposal) return json(404, { error: 'Förslaget finns inte.' });
    if (proposal.user_id !== actor.id && !actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });
    if (proposal.status !== 'pending') return json(409, { error: `Förslaget har redan status ”${PUBLIC_STATUS[proposal.status] || proposal.status}”.` });
    if (new Date(proposal.valid_until) < new Date()) {
      await repo.updateProposal(proposal.id, { status: 'expired' });
      return json(409, { error: 'Förslaget har gått ut.' });
    }
    const onBehalf = proposal.user_id !== actor.id;

    if (route[1] === 'reject') {
      await repo.insertApproval({ proposal_id: proposal.id, decision: 'reject', decided_by: actor.id, on_behalf: onBehalf });
      await repo.updateProposal(proposal.id, { status: 'rejected' });
      return json(200, { status: 'rejected', status_label: PUBLIC_STATUS.rejected });
    }

    if (route[1] === 'approve') {
      // Bekräftelsen måste vara exakt den text som visades ("Din budget går från X till Y kr/mån").
      if (body.confirmation_text !== proposal.confirmation_text) return json(400, { error: 'Bekräftelsen stämmer inte med förslaget. Ladda om och försök igen.' });
      const ws = normalizeWriteSettings(await repo.getWriteSettings(proposal.user_id));
      await repo.insertApproval({
        proposal_id: proposal.id, decision: 'approve', decided_by: actor.id, on_behalf: onBehalf,
        confirmation_text: body.confirmation_text,
        valid_until: new Date(Date.now() + ws.approval_ttl_hours * 3600000).toISOString(),
      });
      await repo.updateProposal(proposal.id, { status: 'approved' });
      return json(200, await runGate(repo, proposal.id, proposal.user_id));
    }

    return json(404, { error: 'Okänd åtgärd' });
  } catch (e) {
    if (e?.code === '23505') return json(409, { error: 'Förslaget har redan ett beslut.' });
    console.error('proposals:', e.message);
    return json(500, { error: e.message });
  }
};

async function runGate(repo, proposalId, customerId) {
  const tokens = await tokensForCustomer(supabase, customerId);
  try {
    const r = await executeApproved({ repo, proposalId, tokens });
    // Modul E: ett genomfört (eller ångrat) byte av annons stäms av mot den trötta annonsen.
    const p = await repo.getProposal(proposalId);
    if (p?.type === 'creative_swap') await (p.kind === 'undo' ? markSwapUndone : markSwapDone)(supabase, p);
    return { ...r, status_label: PUBLIC_STATUS[r.status] };
  } catch (e) {
    if (!(e instanceof WriteBlocked)) throw e;
    const p = await repo.getProposal(proposalId);
    if (p && p.status === 'approved') await repo.updateProposal(proposalId, { status: 'failed', status_reason: e.message });
    return { status: 'failed', status_label: PUBLIC_STATUS.failed, error: e.message, code: e.code };
  }
}

function publicProposal(p, imageUrls = {}) {
  return {
    id: p.id, type: p.type, kind: p.kind, title: describe(p), reason: p.reason,
    support: p.reason_data?.support || [], verdict: p.reason_data?.verdict || null,
    expected: p.expected_outcome?.text || null, confirmation_text: p.confirmation_text,
    status: p.status, status_label: PUBLIC_STATUS[p.status], status_reason: p.status_reason,
    valid_until: p.valid_until, created_at: p.created_at,
    ...(p.type === 'creative_swap' ? {
      variant: {
        label: p.meta?.variant_label || null, asset_type: p.meta?.asset_type || null, kind: p.meta?.variant_kind || null,
        image_url: imageUrls[p.meta?.image_path] || null, texts: p.meta?.texts || {},
      },
    } : {}),
  };
}

// Modul E: bara förslag vars variant fortfarande är Godkänd i granskningen visas. Övriga ersätts.
async function onlyApprovedVariants(pending) {
  const swaps = pending.filter((p) => p.type === 'creative_swap' && p.kind === 'change');
  if (!swaps.length) return { visible: pending, imageUrls: {} };
  const ids = swaps.map((p) => p.meta?.variant_review_id).filter(Boolean);
  const { data: reviews } = await supabase.from('creative_reviews').select('id, fatigue_id, status, verdict, decided_verdict').in('id', ids.length ? ids : [0]);
  const ok = new Set((reviews || []).filter(isApprovedVariant).map((r) => String(r.id)));
  const hidden = swaps.filter((p) => !ok.has(String(p.meta?.variant_review_id)));
  if (hidden.length) {
    await supabase.from('proposals').update({ status: 'superseded', status_reason: 'Varianten är inte godkänd i granskningen.', updated_at: new Date().toISOString() }).in('id', hidden.map((p) => p.id));
  }
  const visible = pending.filter((p) => !hidden.includes(p));
  const paths = visible.filter((p) => p.type === 'creative_swap').map((p) => p.meta?.image_path).filter(Boolean);
  let imageUrls = {};
  if (paths.length) {
    const { data } = await supabase.storage.from('creatives').createSignedUrls(paths, 3600);
    imageUrls = Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }
  return { visible, imageUrls };
}

async function listForCustomer(customerId, actor) {
  const [{ data: ws }, { data: pending }, { data: writes }] = await Promise.all([
    supabase.from('write_settings').select('*').eq('user_id', customerId).maybeSingle(),
    supabase.from('proposals').select('*').eq('user_id', customerId).eq('status', 'pending').gt('valid_until', new Date().toISOString()).order('created_at', { ascending: false }),
    supabase.from('meta_write_log').select('id, proposal_id, object_id, action, status, error, actor_id, on_behalf, created_at, proposals(*)').eq('user_id', customerId).order('created_at', { ascending: false }).limit(10),
  ]);
  const { visible, imageUrls } = await onlyApprovedVariants(pending || []);
  const latestPerObject = new Map();
  for (const w of writes || []) if (w.status !== 'failed' && !latestPerObject.has(w.object_id)) latestPerObject.set(w.object_id, w.id);
  const settings = normalizeWriteSettings(ws);
  return {
    user_id: customerId,
    is_admin: actor.isAdmin,
    on_behalf: customerId !== actor.id,
    settings: { configured: !!ws, writes_enabled: settings.writes_enabled, kill_switch: settings.kill_switch, kill_switch_at: ws?.kill_switch_at || null },
    pending: visible.map((p) => publicProposal(p, imageUrls)),
    recent: (writes || []).map((w) => ({
      write_id: w.id,
      title: w.proposals ? describe(w.proposals) : null,
      status: w.status,
      status_label: { done: 'Genomförd', failed: 'Misslyckades', verifying: 'Verifierar' }[w.status],
      error: w.error,
      by: w.on_behalf ? 'Fabricken å kundens vägnar' : 'Kunden',
      at: w.created_at,
      undoable: w.status === 'done' && w.action === 'apply' && latestPerObject.get(w.object_id) === w.id
        && Date.now() - new Date(w.created_at) < UNDO_DAYS * 86400000,
    })),
  };
}

export default modern(handler);
