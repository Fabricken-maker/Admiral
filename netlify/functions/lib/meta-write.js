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
 * Före skrivningen sparas värdet i meta_write_log. Efter skrivningen läses värdet tillbaka
 * och jämförs: Genomförd, Verifierar (Meta har inte hunnit uppdatera) eller Misslyckades.
 */
import { GRAPH, graphGet, withTokens, MetaError } from './meta-graph.js';
import { checkLimits, monthlyDelta, normalizeWriteSettings, sameValue, isBudgetType, describe, confirmationText } from './proposals.js';

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
  if (json.error) throw new MetaError(`Meta: ${json.error.message}`, json.error.code);
  return json;
}

// ── Läs och skriv värden enligt värdemodellen ─────────────────────────────
export async function readValue(p, token, fetchImpl = fetch) {
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

async function writeValue(p, token, fetchImpl) {
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
      sent = await writeValue(p, token, fetchImpl);
    } catch (e) {
      await repo.updateWriteLog(log.id, { status: 'failed', error: e.message, request: { monthly_delta_sek: 0 } });
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
  const type = orig.type === 'apply_recommendation' ? 'budget_change' : orig.type;
  const p = {
    user_id: w.user_id, ad_account_id: w.ad_account_id, type, kind: 'undo', undo_of_write_id: w.id,
    object_type: orig.object_type, object_id: orig.object_id, object_name: orig.object_name,
    current_value: w.after, proposed_value: w.before, meta: {},
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
