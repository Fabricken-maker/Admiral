import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessAd, assessAccount, weekFromInsight, fatigueReason, expectedOutcome, compareFollowup, normalizeFatigueSettings } from '../netlify/functions/lib/fatigue.js';
import { validateVariant, generateCopyVariants, buildCopyRequest } from '../netlify/functions/lib/copy-variants.js';
import { buildSwapSpec, creativeParams, featuresSpec, swapValues, withNewAdId, variantMedia, NEW_AD } from '../netlify/functions/lib/creative-swap.js';
import { sameValue, describe, confirmationText, checkLimits } from '../netlify/functions/lib/proposals.js';
import { executeApproved, createUndo, isApprovedVariant, WriteBlocked } from '../netlify/functions/lib/meta-write.js';
import { proposeFromVariant, SwapRejected } from '../netlify/functions/lib/fatigue-flow.js';

const NOW = new Date('2026-10-12T08:00:00Z');
const LAST = '2026-10-05';
const week = (start, { impressions = 5000, reach = 2500, clicks = 75, spend = 500, results = 5 } = {}) => ({ week_start: start, impressions, reach, frequency: impressions / reach, clicks, spend, results });

// Annons som tappar effekt: frekvens 2 → 4,1, CTR 1,5 % → 0,9 %, kostnad per resultat 100 → 167 kr.
const TIRED = [
  week('2026-09-07', { impressions: 5000, reach: 2500, clicks: 75, spend: 500, results: 5 }),
  week('2026-09-14', { impressions: 5000, reach: 2500, clicks: 75, spend: 500, results: 5 }),
  week('2026-09-21', { impressions: 5000, reach: 1600, clicks: 60, spend: 500, results: 4 }),
  week('2026-10-05', { impressions: 4100, reach: 1000, clicks: 37, spend: 500, results: 3 }),
];

// ── Upptäckt ──────────────────────────────────────────────────────────────
test('trött annons upptäcks: frekvens upp, CTR ned och kostnad per resultat upp mot egen baslinje', () => {
  const a = assessAd(TIRED, {}, LAST);
  assert.equal(a.status, 'trott');
  assert.deepEqual(a.signals, { frequency_up: true, ctr_down: true, cpa_up: true });
  assert.deepEqual(a.metrics.baseline.weeks, ['2026-09-07', '2026-09-14']);
  assert.equal(a.metrics.baseline.frequency, 2);
  assert.equal(a.metrics.recent.frequency, 4.1);
  assert.equal(a.metrics.change.ctr, -0.3984);
  assert.equal(a.metrics.baseline.cpa, 100);
  assert.equal(a.metrics.recent.cpa, 166.67);
});

test('ingen flaggning under datatröskeln', () => {
  const thin = TIRED.map((w) => ({ ...w, impressions: 800 }));
  assert.equal(assessAd(thin, {}, LAST).status, 'for_lite_data');
  // för få veckor att jämföra med
  assert.equal(assessAd([TIRED[0], TIRED[3]], {}, LAST).status, 'for_lite_data');
  // ingen leverans förra veckan
  assert.equal(assessAd(TIRED.slice(0, 3), {}, LAST).status, 'for_lite_data');
  // tröskeln är konfigurerbar per kund
  assert.equal(assessAd(TIRED, { min_impressions_week: 6000 }, LAST).status, 'for_lite_data');
});

test('annons med bra kostnad per resultat flaggas inte trots trötthetstecken', () => {
  const ok = [...TIRED.slice(0, 3), week('2026-10-05', { impressions: 4100, reach: 1000, clicks: 37, spend: 500, results: 6 })];
  const a = assessAd(ok, {}, LAST);
  assert.equal(a.status, 'ok');
  assert.equal(a.signals.cpa_up, false);
});

test('för få resultat: frekvens och CTR avgör, inga resultat alls räknas som högre kostnad', () => {
  const few = TIRED.map((w) => ({ ...w, results: 1 }));
  const a = assessAd(few, {}, LAST);
  assert.equal(a.signals.cpa_up, null);
  assert.equal(a.status, 'trott');
  const none = [...TIRED.slice(0, 3), { ...TIRED[3], results: 0 }];
  assert.equal(assessAd(none, {}, LAST).signals.cpa_up, true);
});

test('låg frekvens eller stabil CTR ger ingen flaggning', () => {
  const lowFreq = TIRED.map((w) => ({ ...w, reach: w.impressions / 1.2, frequency: 1.2 }));
  assert.equal(assessAd(lowFreq, {}, LAST).status, 'ok');
  const stableCtr = [...TIRED.slice(0, 3), week('2026-10-05', { impressions: 4100, reach: 1000, clicks: 62, spend: 500, results: 3 })];
  assert.equal(assessAd(stableCtr, {}, LAST).status, 'ok');
});

test('Metas veckorader: resultat är största köptypen, aldrig summan', () => {
  const row = (start, extra) => ({
    ad_id: '1', ad_name: 'Annons', adset_id: 'S', campaign_id: 'K', campaign_name: 'Kampanj', date_start: start,
    impressions: '5000', reach: '2500', inline_link_clicks: '75', spend: '500.00',
    actions: [{ action_type: 'purchase', value: '5' }, { action_type: 'omni_purchase', value: '5' }, { action_type: 'link_click', value: '75' }], ...extra,
  });
  assert.equal(weekFromInsight(row('2026-09-07')).results, 5);
  const out = assessAccount([row('2026-09-07'), row('2026-09-14'), row('2026-10-05', { reach: '1000', impressions: '4100', inline_link_clicks: '37', actions: [{ action_type: 'purchase', value: '3' }] })], {}, LAST);
  assert.equal(out.length, 1);
  assert.equal(out[0].ad_name, 'Annons');
  assert.equal(out[0].status, 'trott');
});

test('texten byggs av siffrorna, som i spec:en', () => {
  const m = assessAd(TIRED, {}, LAST).metrics;
  assert.equal(fatigueReason('Höstkampanj', m, 'B'), 'Annonsen ”Höstkampanj” tappar effekt (frekvens 4,1, CTR −40 %, kostnad per resultat +67 %). Förslag: byt till variant B.');
  assert.match(expectedOutcome(m).text, /kostnaden per resultat cirka 100 kr i stället för 167 kr\./);
  const noResults = assessAd(TIRED.map((w) => ({ ...w, results: 0 })), {}, LAST).metrics;
  assert.match(expectedOutcome(noResults).text, /klickfrekvensen cirka 1,5 % i stället för 0,9 %/);
});

test('uppföljning: den nya annonsen jämförs med den gamla, under datatröskeln "För lite data"', () => {
  const before = assessAd(TIRED, {}, LAST).metrics.recent;
  const after = { impressions: 6000, clicks: 90, spend: 600, results: 6, frequency: 1.8, ctr: 0.015, cpa: 100 };
  const f = compareFollowup(before, after, {});
  assert.deepEqual(f.metrics.map((m) => [m.key, m.outcome, m.word]), [['ctr', 'better', 'Bättre'], ['cpa', 'better', 'Bättre'], ['frequency', 'better', 'Bättre']]);
  assert.equal(compareFollowup(before, { ...after, impressions: 300 }, {}).status, 'insufficient');
  assert.equal(compareFollowup(before, { ...after, results: 1 }, {}).metrics.find((m) => m.key === 'cpa').word, 'För lite data');
  assert.equal(normalizeFatigueSettings({ enabled: false }).enabled, false);
});

// ── Admirals egna varianter (texter) ──────────────────────────────────────
const ORIG_TEXTS = { bodies: ['Spela 200 banor i världsklass mitt i Västerås. Boka din tid.'], titles: ['200 banor. Mitt i Västerås.'], descriptions: [] };

test('varianter med påhittade siffror, förbjudna ord eller utan obligatoriska fraser stoppas', () => {
  const ok = { body: 'Byt regnet mot Pebble Beach. 200 banor väntar i Västerås.', title: 'Golf året runt i Västerås', description: '' };
  assert.deepEqual(validateVariant(ok, { texts: ORIG_TEXTS }), []);
  assert.match(validateVariant({ ...ok, body: 'Nu 20 % rabatt på 200 banor.' }, { texts: ORIG_TEXTS })[0], /Siffror som inte finns i originalet: 20/);
  assert.match(validateVariant(ok, { texts: ORIG_TEXTS, profile: { forbidden_words: ['regnet'] } })[0], /Förbjudet ord/);
  assert.match(validateVariant(ok, { texts: ORIG_TEXTS, profile: { required_phrases: ['Boka via Matchi'] } })[0], /Saknar/);
  assert.ok(validateVariant({ ...ok, title: 'x'.repeat(61) }, { texts: ORIG_TEXTS }).includes('Rubriken är för lång'));
});

test('textvarianterna hämtas som strukturerat svar och kontrolleras före granskningen', async () => {
  const req = buildCopyRequest({ texts: ORIG_TEXTS, profile: { tone_notes: 'Avslappnad' }, count: 2 });
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.match(req.messages[0].content, /Ton: Avslappnad/);
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ varianter: [
    { vinkel: 'Väder', annonstext: 'Byt regnet mot Pebble Beach. 200 banor väntar i Västerås.', rubrik: 'Golf året runt', beskrivning: '' },
    { vinkel: 'Pris', annonstext: 'Bara 99 kr i timmen!', rubrik: 'Fynda', beskrivning: '' },
  ] }) }] }) } };
  const r = await generateCopyVariants({ texts: ORIG_TEXTS, profile: {}, count: 2, client });
  assert.equal(r.variants.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].errors[0], /99/);
});

test('inga godkända textförslag eller oläsligt svar: ett nytt försök', async () => {
  let calls = 0;
  const answers = ['inte json', JSON.stringify({ varianter: [{ vinkel: 'x', annonstext: 'Golf året runt i Västerås.', rubrik: 'Golf året runt', beskrivning: '' }] })];
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: answers[calls++] }] }) } };
  const r = await generateCopyVariants({ texts: ORIG_TEXTS, profile: {}, count: 2, client });
  assert.equal(calls, 2);
  assert.equal(r.variants.length, 1);
  const bad = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nej' }] }) } };
  await assert.rejects(generateCopyVariants({ texts: ORIG_TEXTS, profile: {}, count: 2, client: bad }), /inget svar/);
});

// ── Den nya annonsen ──────────────────────────────────────────────────────
const VIDEO_CREATIVE = {
  id: 'C1',
  object_story_spec: { page_id: 'P1', instagram_user_id: 'IG1', video_data: { video_id: 'V1', message: 'Gammal text', title: 'Gammal rubrik', call_to_action: { type: 'LEARN_MORE', value: { link: 'https://exempel.se/' } } } },
};
const FLEX_CREATIVE = {
  id: 'C9',
  object_story_spec: { page_id: 'P2', instagram_user_id: 'IG2' },
  asset_feed_spec: { videos: [{ video_id: 'V7' }], bodies: [{ text: 'a' }], link_urls: [{ website_url: 'https://teebox.se/' }], call_to_action_types: ['BOOK_TRAVEL'] },
  degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_IN' }, video_uncrop: { enroll_status: 'OPT_IN' }, enhance_cta: { enroll_status: 'OPT_IN' } } },
};
const VARIANT = { id: 50, fatigue_id: 9, status: 'klar', verdict: 'godkand', decided_verdict: null, variant_label: 'B', asset_key: 'vid:V1', image_path: 'reviews/3/x.jpg', texts: { bodies: ['Ny text'], titles: ['Ny rubrik'], descriptions: [] } };

test('den nya annonsen får samma sida, länk och knapp, och variantens media och texter', () => {
  const spec = buildSwapSpec({ old: { name: 'Annons A', adset_id: 'S1', creative: VIDEO_CREATIVE }, variant: VARIANT, original: null });
  assert.deepEqual({ page: spec.page_id, ig: spec.instagram_user_id, link: spec.link, cta: spec.cta, media: spec.media, msg: spec.message, title: spec.title },
    { page: 'P1', ig: 'IG1', link: 'https://exempel.se/', cta: 'LEARN_MORE', media: { kind: 'video', video_id: 'V1' }, msg: 'Ny text', title: 'Ny rubrik' });
  assert.equal(spec.ad_name, 'Annons A – variant B (Admiral)');
  const params = creativeParams(spec, { thumbnailUrl: 'https://cdn/t.jpg' });
  assert.deepEqual(params.object_story_spec.video_data, { video_id: 'V1', message: 'Ny text', title: 'Ny rubrik', image_url: 'https://cdn/t.jpg', call_to_action: { type: 'LEARN_MORE', value: { link: 'https://exempel.se/' } } });
  // Samma video som den gamla annonsen: dess sparade omslagsbild återanvänds
  const withHash = { ...VIDEO_CREATIVE, object_story_spec: { ...VIDEO_CREATIVE.object_story_spec, video_data: { ...VIDEO_CREATIVE.object_story_spec.video_data, image_hash: 'TH1' } } };
  const spec2 = buildSwapSpec({ old: { name: 'Annons A', adset_id: 'S1', creative: withHash }, variant: VARIANT, original: null });
  assert.equal(spec2.thumbnail_hash, 'TH1');
  assert.equal(creativeParams(spec2, { thumbnailUrl: 'https://cdn/t.jpg' }).object_story_spec.video_data.image_hash, 'TH1');
  assert.equal(creativeParams(spec2, {}).object_story_spec.video_data.image_url, undefined);
});

test('flexibel annons: länk och knapp ur materialet, paket tas bort och spärrade förbättringar stängs av', () => {
  const spec = buildSwapSpec({ old: { name: 'TB', adset_id: 'S2', creative: FLEX_CREATIVE }, variant: { ...VARIANT, asset_key: 'vid:V7' }, profile: { blocked_features: ['video_uncrop'] } });
  assert.equal(spec.link, 'https://teebox.se/');
  assert.equal(spec.cta, 'BOOK_TRAVEL');
  assert.deepEqual(spec.features, { creative_features_spec: { video_uncrop: { enroll_status: 'OPT_OUT' }, enhance_cta: { enroll_status: 'OPT_IN' } } });
  assert.equal(featuresSpec({}), null);
  assert.deepEqual(variantMedia({ asset_key: 'upl:abc', image_path: 'p.png' }), { kind: 'upload', image_path: 'p.png' });
  const img = creativeParams({ ...spec, media: { kind: 'upload' } }, { imageHash: 'H9', withFeatures: false });
  assert.equal(img.object_story_spec.link_data.image_hash, 'H9');
  assert.equal(img.degrees_of_freedom_spec, undefined);
  assert.throws(() => buildSwapSpec({ old: { name: 'X', creative: { object_story_spec: {} } }, variant: VARIANT }), /sida/);
});

test('värden, texter och gränser för byte av annons', () => {
  const v = swapValues('OLD', 'ACTIVE', 'C1');
  assert.deepEqual(v.proposed, { ads: { OLD: 'PAUSED', [NEW_AD]: 'ACTIVE' } });
  assert.deepEqual(withNewAdId(v.proposed, 'N1'), { ads: { OLD: 'PAUSED', N1: 'ACTIVE' } });
  assert.equal(sameValue('creative_swap', { ads: { OLD: 'ACTIVE' }, creative_ids: { OLD: 'C1' } }, v.current), true);
  assert.equal(sameValue('creative_swap', { ads: { OLD: 'ACTIVE' }, creative_ids: { OLD: 'C2' } }, v.current), false);
  const p = { type: 'creative_swap', kind: 'change', object_name: 'Annons A', meta: { variant_label: 'B' } };
  assert.equal(describe(p), 'Byt annonsen ”Annons A” mot variant B.');
  assert.equal(confirmationText(p), 'Annonsen ”Annons A” pausas och variant B startar som en ny annons.');
  assert.equal(describe({ ...p, kind: 'undo' }), 'Ångra: Starta annonsen ”Annons A” igen och pausa variant B.');
  const limits = checkLimits({ type: 'creative_swap', current: v.current, proposed: v.proposed, settings: { max_actions_per_period: 1 }, periodWrites: [{}] });
  assert.equal(limits.ok, false);
  assert.ok(checkLimits({ type: 'creative_swap', current: v.current, proposed: v.proposed, settings: {} }).ok);
});

test('bara en granskad och Godkänd variant räknas som godkänd', () => {
  assert.equal(isApprovedVariant(VARIANT), true);
  assert.equal(isApprovedVariant({ ...VARIANT, verdict: 'underkand' }), false);
  assert.equal(isApprovedVariant({ ...VARIANT, verdict: 'granska' }), false);
  assert.equal(isApprovedVariant({ ...VARIANT, verdict: 'granska', decided_verdict: 'godkand' }), true);
  assert.equal(isApprovedVariant({ ...VARIANT, decided_verdict: 'underkand' }), false);
  assert.equal(isApprovedVariant({ ...VARIANT, status: 'koar' }), false);
  assert.equal(isApprovedVariant({ ...VARIANT, fatigue_id: null }), false);
});

// ── Skrivgrinden: byte av annons ──────────────────────────────────────────
const ACCOUNT = 'act_1000';
function swapRepo({ variant = VARIANT, approval = {}, settings = {}, settingsAfterCreate = null, media = { kind: 'video', video_id: 'V1' } } = {}) {
  const db = { proposals: new Map(), approvals: new Map(), logs: [], settingsReads: 0 };
  const spec = { page_id: 'P1', instagram_user_id: null, link: 'https://exempel.se/', cta: 'LEARN_MORE', media, message: 'Ny text', title: 'Ny rubrik', description: '', features: null, adset_id: 'S1', ad_name: 'Annons A – variant B (Admiral)' };
  db.proposals.set(1, {
    id: 1, user_id: 3, ad_account_id: ACCOUNT, type: 'creative_swap', kind: 'change', object_type: 'ad', object_id: 'OLD', object_name: 'Annons A',
    status: 'approved', current_value: { ads: { OLD: 'ACTIVE' }, creative_ids: { OLD: 'C1' } }, proposed_value: { ads: { OLD: 'PAUSED', [NEW_AD]: 'ACTIVE' } },
    meta: { swap: spec, variant_review_id: 50, variant_label: 'B', fatigue_id: 9 }, created_at: NOW.toISOString(),
  });
  if (approval !== null) db.approvals.set(1, { id: 11, proposal_id: 1, decision: 'approve', decided_by: 3, on_behalf: false, valid_until: new Date(NOW.getTime() + 3600000).toISOString(), consumed_at: null, ...approval });
  let nextId = 100;
  const base = { user_id: 3, writes_enabled: true, kill_switch: false, ad_account_ids: [ACCOUNT], ...settings };
  return {
    db,
    getProposal: async (id) => db.proposals.get(id) || null,
    getApproval: async (pid) => db.approvals.get(pid) || null,
    getWriteSettings: async () => { db.settingsReads += 1; return settingsAfterCreate && db.created ? { ...base, ...settingsAfterCreate } : base; },
    claimApproval: async (id) => { const a = [...db.approvals.values()].find((x) => x.id === id); if (!a || a.consumed_at) return false; a.consumed_at = NOW.toISOString(); return true; },
    writesSince: async () => [],
    insertWriteLog: async (row) => { const r = { id: nextId++, created_at: NOW.toISOString(), ...row }; db.logs.push(r); return r; },
    updateWriteLog: async (id, patch) => Object.assign(db.logs.find((l) => l.id === id), patch),
    getWriteLog: async (id) => db.logs.find((l) => l.id === id) || null,
    latestWriteForObject: async (oid) => [...db.logs].reverse().find((l) => l.object_id === oid && l.status !== 'failed') || null,
    updateProposal: async (id, patch) => { if (patch.meta?.new_ad_id) db.created = true; return Object.assign(db.proposals.get(id), patch); },
    insertProposal: async (row) => { const r = { id: nextId++, created_at: NOW.toISOString(), ...row }; db.proposals.set(r.id, r); return r; },
    insertApproval: async (row) => { const r = { id: nextId++, consumed_at: null, ...row }; db.approvals.set(row.proposal_id, r); return r; },
    getVariantReview: async (id) => (id === 50 ? variant : null),
    getImageBytes: async () => Buffer.from('bild'),
  };
}

function swapMeta({ oldStatus = 'ACTIVE', oldCreative = 'C1', createdStatus = null } = {}) {
  const ads = { OLD: { status: oldStatus, creative: oldCreative } };
  const ops = [];
  const ok = (body) => ({ json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v[\d.]+\//, '');
    if (opts.method === 'POST') {
      const body = Object.fromEntries(new URLSearchParams(opts.body));
      if (path === `${ACCOUNT}/adimages`) { ops.push('upload'); return ok({ images: { bytes: { hash: 'H9' } } }); }
      if (path === `${ACCOUNT}/adcreatives`) { ops.push('creative'); return ok({ id: 'C2', _params: body }); }
      if (path === `${ACCOUNT}/ads`) {
        ops.push(`create:${body.status}`);
        ads.NEW1 = { status: createdStatus || body.status, creative: JSON.parse(body.creative).creative_id };
        return ok({ id: 'NEW1' });
      }
      ops.push(`${path}:${body.status}`);
      ads[path].status = body.status;
      return ok({ success: true });
    }
    const fields = u.searchParams.get('fields') || '';
    if (fields.startsWith('picture')) return ok({ picture: 'https://cdn/t.jpg' });
    ops.push(`read:${path}`);
    if (fields.includes('creative')) return ok({ status: ads[path].status, creative: { id: ads[path].creative } });
    return ok({ status: ads[path].status });
  };
  return { fetchImpl, ops, ads };
}

const runSwap = (repo, meta) => executeApproved({ repo, proposalId: 1, tokens: ['tok'], now: NOW, fetchImpl: meta.fetchImpl });

test('nytt annonsobjekt skapas pausat, läses tillbaka och aktiveras först därefter', async () => {
  const repo = swapRepo();
  const meta = swapMeta();
  const r = await runSwap(repo, meta);
  assert.equal(r.status, 'done');
  const created = meta.ops.indexOf('create:PAUSED');
  const readBack = meta.ops.indexOf('read:NEW1');
  const activated = meta.ops.indexOf('NEW1:ACTIVE');
  assert.ok(created >= 0 && readBack > created && activated > readBack, meta.ops.join(' → '));
  assert.ok(meta.ops.indexOf('OLD:PAUSED') > activated);
  assert.deepEqual(meta.ads, { OLD: { status: 'PAUSED', creative: 'C1' }, NEW1: { status: 'ACTIVE', creative: 'C2' } });
  const p = repo.db.proposals.get(1);
  assert.deepEqual(p.proposed_value.ads, { OLD: 'PAUSED', NEW1: 'ACTIVE' });
  assert.equal(p.meta.new_ad_id, 'NEW1');
  const log = repo.db.logs[0];
  assert.deepEqual(log.before.ads, { OLD: 'ACTIVE', NEW1: 'PAUSED' });
  assert.equal(log.request.created.status, 'PAUSED');
  assert.equal(log.status, 'done');
});

test('utan godkännande skapas ingen annons', async () => {
  const meta = swapMeta();
  await assert.rejects(runSwap(swapRepo({ approval: null }), meta), (e) => e instanceof WriteBlocked && e.code === 'no_approval');
  assert.deepEqual(meta.ops, []);
});

test('underkänd eller ogranskad variant publiceras aldrig, inte ens med godkännande', async () => {
  for (const variant of [{ ...VARIANT, verdict: 'underkand' }, { ...VARIANT, verdict: 'granska' }, { ...VARIANT, status: 'analyserar' }, { ...VARIANT, decided_verdict: 'underkand' }]) {
    const repo = swapRepo({ variant });
    const meta = swapMeta();
    await assert.rejects(runSwap(repo, meta), (e) => e.code === 'variant_not_approved');
    assert.deepEqual(meta.ops, []);
    assert.equal(repo.db.proposals.get(1).status, 'failed');
  }
});

test('nödstopp efter att annonsen skapats: den ligger kvar pausad', async () => {
  const repo = swapRepo({ settingsAfterCreate: { kill_switch: true } });
  const meta = swapMeta();
  const r = await runSwap(repo, meta);
  assert.equal(r.status, 'failed');
  assert.equal(meta.ads.NEW1.status, 'PAUSED');
  assert.equal(meta.ads.OLD.status, 'ACTIVE');
  assert.ok(!meta.ops.includes('NEW1:ACTIVE'));
  assert.equal(repo.db.logs[0].request.created.ad_id, 'NEW1');
});

test('om Meta inte skapar annonsen pausad startas den inte', async () => {
  const meta = swapMeta({ createdStatus: 'ACTIVE' });
  const r = await runSwap(swapRepo(), meta);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /inte pausad/);
  assert.ok(!meta.ops.includes('OLD:PAUSED'));
});

test('den gamla annonsen har ändrats: inget skapas', async () => {
  for (const m of [swapMeta({ oldStatus: 'PAUSED' }), swapMeta({ oldCreative: 'C5' })]) {
    await assert.rejects(runSwap(swapRepo(), m), (e) => e.code === 'stale');
    assert.ok(!m.ops.some((o) => o.startsWith('create') || o === 'creative'));
  }
});

test('uppladdad variant: bilden laddas upp till Meta före annonsdesignen', async () => {
  const meta = swapMeta();
  const r = await runSwap(swapRepo({ media: { kind: 'upload', image_path: 'reviews/3/v.png' }, variant: { ...VARIANT, asset_key: 'upl:x' } }), meta);
  assert.equal(r.status, 'done');
  assert.ok(meta.ops.indexOf('upload') < meta.ops.indexOf('creative'));
});

test('Ångra: den gamla annonsen startar igen och den nya pausas', async () => {
  const repo = swapRepo();
  const meta = swapMeta();
  const r = await runSwap(repo, meta);
  const undo = await createUndo({ repo, writeId: r.write_id, actorId: 3, onBehalf: false, now: NOW });
  assert.equal(undo.title, 'Ångra: Starta annonsen ”Annons A” igen och pausa variant B.');
  const u = await executeApproved({ repo, proposalId: undo.id, tokens: ['tok'], now: NOW, fetchImpl: meta.fetchImpl });
  assert.equal(u.status, 'done');
  assert.deepEqual({ old: meta.ads.OLD.status, new: meta.ads.NEW1.status }, { old: 'ACTIVE', new: 'PAUSED' });
});

// ── Förslag av varianter ──────────────────────────────────────────────────
function fakeSupabase(tables) {
  const updates = [];
  return {
    updates,
    from(table) {
      const q = { filters: [], patch: null };
      const rows = () => (tables[table] || []).filter((r) => q.filters.every(([k, v]) => String(r[k]) === String(v)));
      const chain = {
        select: () => chain,
        eq: (k, v) => { q.filters.push([k, v]); return chain; },
        update: (patch) => { q.patch = patch; return chain; },
        maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
        then: (res, rej) => {
          const hit = rows();
          if (q.patch) { hit.forEach((r) => Object.assign(r, q.patch)); updates.push({ table, patch: q.patch, n: hit.length }); }
          return Promise.resolve({ data: hit, error: null }).then(res, rej);
        },
      };
      return chain;
    },
  };
}

const FATIGUE = { id: 9, user_id: 3, ad_account_id: ACCOUNT, ad_id: 'OLD', ad_name: 'Annons A', status: 'trott', proposal_id: null, metrics: assessAd(TIRED, {}, LAST).metrics };
const fakeStore = { getReview: async () => null, getProfile: async () => ({ blocked_features: [] }) };

test('underkänd variant blir aldrig ett förslag', async () => {
  for (const review of [{ ...VARIANT, verdict: 'underkand' }, { ...VARIANT, verdict: 'granska' }, { ...VARIANT, status: 'koar' }]) {
    const supabase = fakeSupabase({ ad_fatigue: [{ ...FATIGUE }], write_settings: [{ user_id: 3, writes_enabled: true, ad_account_ids: [ACCOUNT] }] });
    const repo = swapRepo();
    const before = repo.db.proposals.size;
    const r = await proposeFromVariant({ supabase, repo, store: fakeStore, review, tokens: ['tok'], now: NOW, fetchImpl: swapMeta().fetchImpl });
    assert.equal(r.skipped, 'inte_godkand');
    assert.equal(repo.db.proposals.size, before);
    assert.equal(supabase.updates.length, 0);
  }
});

test('godkänd variant blir ett förslag med skäl, bild och förväntat utfall', async () => {
  const supabase = fakeSupabase({ ad_fatigue: [{ ...FATIGUE }], write_settings: [{ user_id: 3, writes_enabled: true, ad_account_ids: [ACCOUNT] }], proposals: [] });
  const repo = swapRepo();
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/OLD')) return { json: async () => ({ name: 'Annons A', status: 'ACTIVE', adset_id: 'S1', account_id: '1000', creative: VIDEO_CREATIVE }) };
    return { json: async () => ({}) };
  };
  const r = await proposeFromVariant({ supabase, repo, store: fakeStore, review: VARIANT, tokens: ['tok'], now: NOW, fetchImpl });
  const p = r.proposal;
  assert.equal(p.type, 'creative_swap');
  assert.equal(p.status, 'pending');
  assert.equal(p.reason, 'Annonsen ”Annons A” tappar effekt (frekvens 4,1, CTR −40 %, kostnad per resultat +67 %). Förslag: byt till variant B.');
  assert.match(p.expected_outcome.text, /100 kr/);
  assert.equal(p.meta.image_path, 'reviews/3/x.jpg');
  assert.equal(p.meta.swap.media.video_id, 'V1');
  assert.deepEqual(p.current_value, { ads: { OLD: 'ACTIVE' }, creative_ids: { OLD: 'C1' } });
  assert.equal(supabase.from('ad_fatigue') && (await supabase.from('ad_fatigue').select().eq('id', 9).maybeSingle()).data.proposal_id, p.id);
});

test('kampanj med äldre mål: inget förslag, eftersom Meta inte tar emot nya annonser där', async () => {
  const supabase = fakeSupabase({ ad_fatigue: [{ ...FATIGUE }], write_settings: [{ user_id: 3, writes_enabled: true, ad_account_ids: [ACCOUNT] }], proposals: [] });
  const fetchImpl = async () => ({ json: async () => ({ name: 'Annons A', status: 'ACTIVE', adset_id: 'S1', campaign: { objective: 'VIDEO_VIEWS' }, creative: VIDEO_CREATIVE }) });
  await assert.rejects(proposeFromVariant({ supabase, repo: swapRepo(), store: fakeStore, review: VARIANT, tokens: ['tok'], now: NOW, fetchImpl }), /äldre kampanjmål/);
});

test('Metas förklaring används i felmeddelandet', async () => {
  const meta = swapMeta();
  const failing = async (url, opts) => (opts?.method === 'POST' && url.endsWith('/ads') ? { json: async () => ({ error: { message: 'Invalid parameter', code: 100, error_user_msg: 'Legacy objective is no longer available in ad creation.' } }) } : meta.fetchImpl(url, opts));
  const r = await executeApproved({ repo: swapRepo(), proposalId: 1, tokens: ['tok'], now: NOW, fetchImpl: failing });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Legacy objective/);
});

test('utan skrivbehörighet blir det inget förslag, och skälet sparas', async () => {
  const supabase = fakeSupabase({ ad_fatigue: [{ ...FATIGUE }], write_settings: [] });
  await assert.rejects(proposeFromVariant({ supabase, repo: swapRepo(), store: fakeStore, review: VARIANT, tokens: ['tok'], now: NOW }), (e) => e instanceof SwapRejected && /skrivbehörighet/.test(e.message));
});
