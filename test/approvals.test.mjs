import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { executeApproved, createUndo, reverify, WriteBlocked } from '../netlify/functions/lib/meta-write.js';
import { checkLimits, confirmationText, describe, normalizeWriteSettings } from '../netlify/functions/lib/proposals.js';
import { simulateBudget, simulateAdStatus } from '../netlify/functions/lib/simulate.js';
import { judgeBudgetChange, judgeAdPause, judgeRecommendation } from '../netlify/functions/lib/judge.js';
import { createState, verifyState } from '../netlify/functions/lib/oauth-state.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const ADSET = '7000000000001';
const ACCOUNT = 'act_1000';

// ── Minnesrepo och påhittat Meta ─────────────────────────────────────────
function memoryRepo({ settings = {}, approval = {}, proposal = {} } = {}) {
  const db = {
    settings: { user_id: 3, writes_enabled: true, kill_switch: false, ad_account_ids: [ACCOUNT], monthly_budget_cap_sek: 10000, ...settings },
    proposals: new Map(),
    approvals: new Map(),
    logs: [],
    settingsReads: 0,
  };
  const p = {
    id: 1, user_id: 3, ad_account_id: ACCOUNT, type: 'budget_change', kind: 'change', object_type: 'adset',
    object_id: ADSET, object_name: 'Testuppsättning', status: 'approved', meta: {},
    current_value: { budgets: { [ADSET]: 5000 } }, proposed_value: { budgets: { [ADSET]: 6000 } },
    created_at: NOW.toISOString(), ...proposal,
  };
  db.proposals.set(p.id, p);
  if (approval !== null) {
    db.approvals.set(p.id, { id: 11, proposal_id: p.id, decision: 'approve', decided_by: 3, on_behalf: false, valid_until: new Date(NOW.getTime() + 3600000).toISOString(), consumed_at: null, ...approval });
  }
  let nextId = 100;
  const repo = {
    db,
    getProposal: async (id) => db.proposals.get(id) || null,
    getApproval: async (pid) => db.approvals.get(pid) || null,
    getWriteSettings: async () => { db.settingsReads += 1; return typeof db.settings === 'function' ? db.settings(db.settingsReads) : db.settings; },
    claimApproval: async (id) => {
      const a = [...db.approvals.values()].find((x) => x.id === id);
      if (!a || a.consumed_at) return false;
      a.consumed_at = NOW.toISOString();
      return true;
    },
    writesSince: async () => db.logs.map((l) => ({ ...l, monthly_delta_sek: l.request?.monthly_delta_sek || 0 })),
    insertWriteLog: async (row) => { const r = { id: nextId++, created_at: NOW.toISOString(), ...row }; db.logs.push(r); return r; },
    updateWriteLog: async (id, patch) => Object.assign(db.logs.find((l) => l.id === id), patch),
    getWriteLog: async (id) => db.logs.find((l) => l.id === id) || null,
    latestWriteForObject: async (oid) => [...db.logs].reverse().find((l) => l.object_id === oid && l.status !== 'failed') || null,
    updateProposal: async (id, patch) => Object.assign(db.proposals.get(id), patch),
    insertProposal: async (row) => { const r = { id: nextId++, created_at: NOW.toISOString(), ...row }; db.proposals.set(r.id, r); return r; },
    insertApproval: async (row) => { const r = { id: nextId++, consumed_at: null, ...row }; db.approvals.set(row.proposal_id, r); return r; },
  };
  return repo;
}

function fakeMeta({ budget = 5000, status = 'ACTIVE', delivering = 'PAUSED', applyWrites = true, writeError = null } = {}) {
  const state = { budget, status };
  const posts = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const id = u.pathname.split('/').pop();
    if (opts.method === 'POST') {
      const body = Object.fromEntries(new URLSearchParams(opts.body));
      posts.push({ id, body });
      if (writeError) return { json: async () => ({ error: writeError }) };
      if (applyWrites) {
        if (body.daily_budget) state.budget = Number(body.daily_budget);
        if (body.status) state.status = body.status;
      }
      return { json: async () => ({ success: true }) };
    }
    const fields = u.searchParams.get('fields') || '';
    if (u.pathname.endsWith('/adsets') || u.pathname.endsWith('/campaigns')) return { json: async () => ({ data: [] }) };
    if (fields.includes('effective_status')) return { json: async () => ({ effective_status: delivering }) };
    if (fields.includes('daily_budget')) return { json: async () => ({ daily_budget: String(state.budget) }) };
    if (fields.includes('status')) return { json: async () => ({ status: state.status }) };
    return { json: async () => ({}) };
  };
  return { fetchImpl, posts, state };
}

const run = (repo, meta, extra = {}) => executeApproved({ repo, proposalId: 1, tokens: ['tok'], now: NOW, fetchImpl: meta.fetchImpl, ...extra });

// ── Grinden ──────────────────────────────────────────────────────────────
test('godkänt förslag skrivs, läses tillbaka, loggas med före/efter och blir Genomförd', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta();
  const r = await run(repo, meta);
  assert.equal(r.status, 'done');
  assert.equal(meta.posts.length, 1);
  assert.deepEqual(meta.posts[0], { id: ADSET, body: { daily_budget: '6000', access_token: 'tok' } });
  const log = repo.db.logs[0];
  assert.deepEqual(log.before, { budgets: { [ADSET]: 5000 } });
  assert.deepEqual(log.after, { budgets: { [ADSET]: 6000 } });
  assert.equal(log.status, 'done');
  assert.equal(log.request.monthly_delta_sek, 304);
  assert.equal(repo.db.proposals.get(1).status, 'done');
  assert.ok(repo.db.approvals.get(1).consumed_at);
});

test('utan registrerat godkännande sker ingen skrivning', async () => {
  const repo = memoryRepo({ approval: null });
  const meta = fakeMeta();
  await assert.rejects(run(repo, meta), (e) => e instanceof WriteBlocked && e.code === 'no_approval');
  assert.equal(meta.posts.length, 0);
});

test('ett avslag är inget godkännande', async () => {
  const repo = memoryRepo({ approval: { decision: 'reject' } });
  const meta = fakeMeta();
  await assert.rejects(run(repo, meta), (e) => e.code === 'no_approval');
  assert.equal(meta.posts.length, 0);
});

test('nödstopp stoppar alla skrivningar', async () => {
  const repo = memoryRepo({ settings: { kill_switch: true } });
  const meta = fakeMeta();
  await assert.rejects(run(repo, meta), (e) => e.code === 'kill_switch');
  assert.equal(meta.posts.length, 0);
});

test('nödstopp som slås på mitt i flödet stoppar skrivningen precis före anropet', async () => {
  const repo = memoryRepo();
  const base = repo.db.settings;
  repo.db.settings = (n) => ({ ...base, kill_switch: n > 1 }); // första kontrollen ok, andra stoppar
  const meta = fakeMeta();
  await assert.rejects(run(repo, meta), (e) => e.code === 'kill_switch');
  assert.equal(meta.posts.length, 0);
  assert.equal(repo.db.proposals.get(1).status, 'failed');
});

test('utan skrivbehörighet eller för fel konto sker ingen skrivning', async () => {
  const meta = fakeMeta();
  await assert.rejects(run(memoryRepo({ settings: { writes_enabled: false } }), meta), (e) => e.code === 'writes_disabled');
  await assert.rejects(run(memoryRepo({ settings: { ad_account_ids: ['act_annat'] } }), meta), (e) => e.code === 'account');
  assert.equal(meta.posts.length, 0);
});

test('godkännandet går ut efter sin giltighetstid', async () => {
  const repo = memoryRepo({ approval: { valid_until: new Date(NOW.getTime() - 1000).toISOString() } });
  const meta = fakeMeta();
  await assert.rejects(run(repo, meta), (e) => e.code === 'approval_expired');
  assert.equal(meta.posts.length, 0);
});

test('ett godkännande kan bara användas en gång (idempotent)', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta();
  const [a, b] = await Promise.allSettled([run(repo, meta), run(repo, meta)]);
  const ok = [a, b].filter((x) => x.status === 'fulfilled');
  const blocked = [a, b].filter((x) => x.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(blocked.length, 1);
  assert.ok(['approval_used', 'wrong_status'].includes(blocked[0].reason.code));
  assert.equal(meta.posts.length, 1);
  // Och en tredje gång efteråt
  repo.db.proposals.get(1).status = 'approved';
  await assert.rejects(run(repo, meta), (e) => e.code === 'approval_used');
  assert.equal(meta.posts.length, 1);
});

test('förslag över maxgränsen avvisas med tydligt fel och skrivs inte', async () => {
  const repo = memoryRepo({ proposal: { proposed_value: { budgets: { [ADSET]: 9000 } } } }); // +80 %
  const meta = fakeMeta();
  await assert.rejects(run(repo, meta), (e) => e.code === 'limit' && /80 % av nuvarande budget\. Gränsen är 30 %/.test(e.message));
  assert.equal(meta.posts.length, 0);
  assert.equal(repo.db.approvals.get(1).consumed_at, null);
});

test('har värdet ändrats i Meta sedan förslaget skrivs inget', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta({ budget: 5500 });
  await assert.rejects(run(repo, meta), (e) => e.code === 'stale');
  assert.equal(meta.posts.length, 0);
  assert.match(repo.db.proposals.get(1).status_reason, /ändrats sedan förslaget/);
});

test('Metas fel loggas och förslaget blir Misslyckades', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta({ writeError: { code: 100, message: 'Invalid parameter' } });
  const r = await run(repo, meta);
  assert.equal(r.status, 'failed');
  assert.equal(repo.db.logs[0].status, 'failed');
  assert.match(repo.db.logs[0].error, /Invalid parameter/);
});

test('ogiltigt token (190) provar nästa token utan att skriva två gånger', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta();
  const inner = meta.fetchImpl;
  const fetchImpl = async (url, opts) => (new URL(url).searchParams.get('access_token') === 'dött' || (opts?.body && String(opts.body).includes('access_token=d%C3%B6tt'))
    ? { json: async () => ({ error: { code: 190, message: 'Invalid OAuth access token' } }) }
    : inner(url, opts));
  const r = await executeApproved({ repo, proposalId: 1, tokens: ['dött', 'tok'], now: NOW, fetchImpl });
  assert.equal(r.status, 'done');
  assert.equal(meta.posts.length, 1);
});

test('syns inte ändringen direkt blir den Verifierar och bekräftas sedan av underhållsjobbet', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta({ applyWrites: false });
  const r = await run(repo, meta);
  assert.equal(r.status, 'verifying');
  meta.state.budget = 6000; // Meta har nu uppdaterat
  assert.equal(await reverify({ repo, writeLog: repo.db.logs[0], tokens: ['tok'], now: NOW, fetchImpl: meta.fetchImpl }), 'done');
  assert.equal(repo.db.proposals.get(1).status, 'done');
});

test('Ångra återställer det sparade före-värdet genom samma grind', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta();
  await run(repo, meta);
  const undo = await createUndo({ repo, writeId: repo.db.logs[0].id, actorId: 3, onBehalf: false, now: NOW });
  assert.equal(undo.kind, 'undo');
  assert.match(undo.confirmation_text, /^Ångra: Din budget går från 1 824 till 1 520 kr\/mån\.$/);
  const r = await executeApproved({ repo, proposalId: undo.id, tokens: ['tok'], now: NOW, fetchImpl: meta.fetchImpl });
  assert.equal(r.status, 'done');
  assert.equal(meta.state.budget, 5000);
  assert.equal(meta.posts.length, 2);
  assert.equal(repo.db.logs[1].action, 'undo');
});

test('Ångra stoppas av nödstoppet', async () => {
  const repo = memoryRepo();
  const meta = fakeMeta();
  await run(repo, meta);
  const undo = await createUndo({ repo, writeId: repo.db.logs[0].id, actorId: 3, onBehalf: false, now: NOW });
  repo.db.settings = { ...repo.db.settings, kill_switch: true };
  await assert.rejects(executeApproved({ repo, proposalId: undo.id, tokens: ['tok'], now: NOW, fetchImpl: meta.fetchImpl }), (e) => e.code === 'kill_switch');
  assert.equal(meta.posts.length, 1);
});

test('annonsstatus: pausa skrivs och verifieras', async () => {
  const repo = memoryRepo({ proposal: { type: 'ad_status', object_type: 'ad', object_id: '8000', current_value: { status: 'ACTIVE' }, proposed_value: { status: 'PAUSED' } } });
  const meta = fakeMeta({ status: 'ACTIVE' });
  const r = await run(repo, meta);
  assert.equal(r.status, 'done');
  assert.deepEqual(meta.posts[0].body, { status: 'PAUSED', access_token: 'tok' });
});

test('Metas rekommendation appliceras med signatur och extra_data, och kontrolleras mot budgeten', async () => {
  const repo = memoryRepo({ proposal: {
    type: 'apply_recommendation', meta: { recommendation_signature: 'sig-1', extra_data: { adsets: [{ ad_object_id: ADSET, additional_budget: 1000 }] } },
  } });
  const meta = fakeMeta();
  const fetchImpl = async (url, opts) => {
    if (opts?.method === 'POST' && url.endsWith('/recommendations')) {
      meta.posts.push({ id: 'recommendations', body: Object.fromEntries(new URLSearchParams(opts.body)) });
      meta.state.budget += 1000;
      return { json: async () => ({ success: true }) };
    }
    return meta.fetchImpl(url, opts);
  };
  const r = await run(repo, meta, { fetchImpl });
  assert.equal(r.status, 'done');
  assert.equal(meta.posts[0].body.recommendation_signature, 'sig-1');
  assert.equal(meta.posts[0].body.extra_data, JSON.stringify({ adsets: [{ ad_object_id: ADSET, additional_budget: 1000 }] }));
});

// ── Gränser ──────────────────────────────────────────────────────────────
const S = normalizeWriteSettings({ monthly_budget_cap_sek: 5000 });
const b = (c) => ({ budgets: { [ADSET]: c } });

test('gränser: procent, kronor per åtgärd, period, antal och tak', () => {
  assert.ok(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(6000), settings: S }).ok);
  assert.match(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(7000), settings: S }).errors[0], /40 %/);
  assert.match(checkLimits({ type: 'budget_change', current: b(50000), proposed: b(60000), settings: S }).errors.join(), /3 040 kr\/mån\. Gränsen är 1 500 kr\/mån per åtgärd/);
  assert.match(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(6000), settings: S, periodWrites: [{ monthly_delta_sek: 2900 }] }).errors[0], /3 204 kr\/mån\. Gränsen är 3 000/);
  assert.match(checkLimits({ type: 'ad_status', current: { status: 'ACTIVE' }, proposed: { status: 'PAUSED' }, settings: S, periodWrites: Array(10).fill({}) }).errors[0], /10 ändringar/);
  assert.ok(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(6000), settings: S, delivery: { delivering: true, accountDailyCents: 15000 } }).ok); // 4 864 kr ≤ taket
  assert.match(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(6000), settings: S, delivery: { delivering: true, accountDailyCents: 16000 } }).errors[0], /Kontots månadsbudget blir 5 168 kr\. Taket är 5 000 kr/);
  assert.match(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(6000), settings: normalizeWriteSettings({}), delivery: { delivering: true, accountDailyCents: 5000 } }).errors[0], /Inget budgettak/);
  // Sänkning och pausat objekt påverkas inte av taket
  assert.ok(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(4000), settings: normalizeWriteSettings({}), delivery: { delivering: true, accountDailyCents: 99999 } }).ok);
  assert.match(checkLimits({ type: 'budget_change', current: b(5000), proposed: b(5000), settings: S }).errors[0], /samma som nuvarande/);
  // Ångra prövas inte mot gränserna
  assert.ok(checkLimits({ type: 'budget_change', kind: 'undo', current: b(9000), proposed: b(5000), settings: S }).ok);
});

// ── Texter, simulator och Modul A ─────────────────────────────────────────
test('texter: vad, bekräftelse med belopp per månad', () => {
  const p = { type: 'budget_change', object_name: 'TB_Test', current_value: b(17500), proposed_value: b(21000) };
  assert.equal(describe(p), 'Höj dagsbudgeten för ”TB_Test” från 175 kr till 210 kr.');
  assert.equal(confirmationText(p), 'Din budget går från 5 320 till 6 384 kr/mån.');
  const ad = { type: 'ad_status', object_name: 'Annons A', current_value: { status: 'ACTIVE' }, proposed_value: { status: 'PAUSED' } };
  assert.equal(describe(ad), 'Pausa annonsen ”Annons A”.');
  assert.equal(confirmationText(ad), 'Annonsen ”Annons A” pausas.');
});

test('simulator: spend i kronor och resultat med avtagande avkastning', () => {
  const s = simulateBudget({ before: { a: 17500 }, after: { a: 21000 }, stats: { spend: 4900, results: 20, revenue: 0 }, settings: {} });
  assert.equal(s.monthly_delta_sek, 1064);
  assert.equal(s.cost_per_result_sek, 245);
  assert.equal(s.results_delta, 4); // 1 064 / (245 × 1,2)
  assert.equal(s.text, '+1 064 kr/mån i spend och ca +4 resultat/mån.');
  const thin = simulateBudget({ before: { a: 5000 }, after: { a: 6000 }, stats: { spend: 100, results: 1 } });
  assert.equal(thin.text, '+304 kr/mån i spend. För lite data för att uppskatta resultat.');
  assert.match(simulateAdStatus({ to: 'PAUSED', adStats: { spend: 1240, results: 1 } }).text, /1 346 kr\/mån flyttas/);
});

test('Modul A: Gör, Avstå, Avvakta och För lite data från egen data', () => {
  const goals = { target_cpa: 333, min_results: 3, min_spend_sek: 300 };
  const st = (spend, results) => ({ days: 14, spend, results, revenue: 0 });
  assert.equal(judgeBudgetChange('up', st(2100, 10), goals).verdict, 'gor');
  assert.equal(judgeBudgetChange('up', st(2100, 10), goals).reason, 'Kostnad per resultat har varit 210 kr de senaste 14 dagarna, målet är 333 kr.');
  assert.equal(judgeBudgetChange('up', st(5000, 10), goals).verdict, 'avsta');
  assert.equal(judgeBudgetChange('up', st(3600, 10), goals).verdict, 'avvakta');
  assert.equal(judgeBudgetChange('down', st(5000, 10), goals).verdict, 'gor');
  assert.equal(judgeBudgetChange('up', st(800, 1), goals).verdict, 'for_lite_data');
  assert.equal(judgeBudgetChange('up', st(800, 1), goals).support.length, 3);
  assert.equal(judgeAdPause({ days: 14, spend: 1500, results: 1 }, { days: 14, spend: 3000, results: 15 }, goals).verdict, 'gor');
  assert.equal(judgeRecommendation({ type: 'MUSIC' }, st(0, 0), goals).verdict, 'avvakta');
  assert.equal(judgeRecommendation({ type: 'SCALE_GOOD_CAMPAIGN' }, st(2100, 10), goals).verdict, 'avvakta'); // utan signatur
  assert.equal(judgeRecommendation({ type: 'SCALE_GOOD_CAMPAIGN', recommendation_signature: 's' }, st(2100, 10), goals).verdict, 'gor');
});

// ── OAuth-state ──────────────────────────────────────────────────────────
test('OAuth-state är signerad, går inte att förfalska och går ut efter 10 minuter', () => {
  const t = Date.UTC(2026, 9, 9, 12);
  const state = createState(6, 'hemlig', t);
  assert.equal(verifyState(state, 'hemlig', t + 60000).userId, 6);
  const [payload] = state.split('.');
  const forged = `${Buffer.from(JSON.stringify({ userId: 3, ts: t })).toString('base64url')}.${state.split('.')[1]}`;
  assert.throws(() => verifyState(forged, 'hemlig', t), /invalid_state/);
  assert.throws(() => verifyState(state, 'annan', t), /invalid_state/);
  assert.throws(() => verifyState(state, 'hemlig', t + 11 * 60000), /invalid_state/);
  assert.throws(() => verifyState(payload, 'hemlig', t), /invalid_state/);
  assert.throws(() => verifyState(Buffer.from(JSON.stringify({ userId: 3, ts: t })).toString('base64'), 'hemlig', t), /invalid_state/);
});

// ── Ingen annan kod skriver till Meta ─────────────────────────────────────
test('bara lib/meta-write.js skriver till Meta', () => {
  const root = new URL('../netlify/functions/', import.meta.url).pathname;
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && files.push(path.join(d, e.name))));
  walk(root);
  for (const f of files) {
    if (f.endsWith('lib/meta-write.js')) continue;
    const src = fs.readFileSync(f, 'utf8');
    const talksToMeta = /graph\.facebook\.com|from '\.\/(lib\/)?meta-graph\.js'|GRAPH\b/.test(src);
    if (talksToMeta) assert.ok(!/method:\s*['"](POST|DELETE)['"]|graphPost\(/.test(src), `${path.relative(root, f)} skriver till Meta utanför skrivgrinden`);
  }
});
