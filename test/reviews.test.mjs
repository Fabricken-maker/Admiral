import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { imageType, imageSize, decodeImage } from '../netlify/functions/lib/image-decode.js';
import {
  checkFormat, checkColors, scanTexts, checkFeatures, featuresFromSpec, verdictFor, rankedFindings,
  deltaE, rgbToLab, hexToRgb, dominantColors, samplePixels,
} from '../netlify/functions/lib/review-rules.js';
import { checksFromVision, manualChecks, buildRequest, responseSchema, assessImage } from '../netlify/functions/lib/review-vision.js';
import { textsFromCreative, mediaFromCreative, collectAssets, contentKey } from '../netlify/functions/lib/review-meta.js';
import { runReview, redact } from '../netlify/functions/lib/review-run.js';
import { signInternal, verifyInternal } from '../netlify/functions/lib/internal-auth.js';
import { normalizeProfile, ProfileInvalid } from '../netlify/functions/lib/brand-profile.js';
import { latestPerAsset, DEFAULT_PROFILE } from '../netlify/functions/lib/review-store.js';

// ── Testbilder ────────────────────────────────────────────────────────────
// Övre halvan i färg a, nedre i färg b.
function rgba(width, height, a, b) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, bl] = y < height / 2 ? a : b;
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = 255;
    }
  }
  return data;
}
const makePng = (w, h, a, b) => { const p = new PNG({ width: w, height: h }); rgba(w, h, a, b).copy(p.data); return PNG.sync.write(p); };
const makeJpeg = (w, h, a, b) => jpeg.encode({ width: w, height: h, data: rgba(w, h, a, b) }, 95).data;
const CYAN = [0, 217, 255];
const GRAY = [128, 128, 128];

test('bildformat och mått läses ur JPEG och PNG', () => {
  const j = makeJpeg(108, 192, CYAN, GRAY);
  const p = makePng(100, 100, CYAN, GRAY);
  assert.equal(imageType(j), 'jpeg');
  assert.equal(imageType(p), 'png');
  assert.deepEqual(imageSize(j), { type: 'jpeg', width: 108, height: 192 });
  assert.deepEqual(imageSize(p), { type: 'png', width: 100, height: 100 });
  const d = decodeImage(p);
  assert.equal(d.data.length, 100 * 100 * 4);
  assert.deepEqual([...d.data.slice(0, 3)], CYAN);
  assert.equal(imageType(Buffer.from('inte en bild')), null);
});

test('format: helskärm godkänns, låg upplösning och ovanligt format flaggas', () => {
  const ok = checkFormat({ width: 1080, height: 1920, assetType: 'video' });
  assert.equal(ok.status, 'ok');
  assert.match(ok.summary, /^Videon är Helskärm 9:16, 1\s080 px × 1\s920 px\.$/);
  assert.equal(checkFormat({ width: 500, height: 500 }).status, 'fel');
  assert.equal(checkFormat({ width: 1000, height: 1000 }).status, 'varning');
  const odd = checkFormat({ width: 2400, height: 1100 });
  assert.equal(odd.status, 'varning');
  assert.match(odd.findings[0].title, /Ovanligt format/);
  assert.equal(checkFormat({}).status, 'manuell');
});

test('CIEDE2000 stämmer med referensvärde', () => {
  // Sharma, Wu & Dalal (2005), par 1
  assert.ok(Math.abs(deltaE([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 1e-3);
  assert.equal(deltaE(rgbToLab([10, 20, 30]), rgbToLab([10, 20, 30])), 0);
});

test('färger: varumärkets färg hittas, annars varning, utan palett manuell', () => {
  const img = decodeImage(makePng(200, 200, CYAN, GRAY));
  const dom = dominantColors(samplePixels(img));
  assert.equal(dom.length, 2);
  assert.ok(Math.abs(dom[0].share - 0.5) < 0.02);

  const ok = checkColors(img, [{ hex: '#00d9ff', name: 'Cyan' }]);
  assert.equal(ok.status, 'ok');
  assert.match(ok.summary, /Cyan \(50 %\)/);
  const miss = checkColors(img, [{ hex: '#c0392b', name: 'Röd' }]);
  assert.equal(miss.status, 'varning');
  assert.equal(checkColors(img, []).status, 'info');
  assert.equal(checkColors({ data: null }, [{ hex: '#000000' }]).status, 'manuell');
  assert.deepEqual(hexToRgb('#00D9FF'), CYAN);
  assert.equal(hexToRgb('blå'), null);
});

test('texter: DB Golfs annonstext ger inga fynd', () => {
  const r = scanTexts({ texts: {
    bodies: ['Spela St Andrews på lunchen. Nästan 200 banor i världsklass – Valderrama, Pebble Beach – mitt i Västerås.'],
    titles: ['Spela St Andrews på lunchen?', '200 banor. Mitt i Västerås.'],
    descriptions: ['Erikslund, Västerås · Trackman 4. TeeBox'],
  } });
  assert.equal(r.status, 'ok');
  assert.equal(r.findings.length, 0);
  // "bästa" i vardaglig mening flaggas inte, "bäst" som påstående gör det
  assert.equal(scanTexts({ texts: { bodies: ['Slå dina bästa slag i vinter.'] } }).findings.length, 0);
});

test('texter: lag och Metas regler flaggas med var och citat', () => {
  const r = scanTexts({
    texts: { bodies: ['Sveriges bästa golfsimulator – helt gratis!!!'], titles: ['Rea -20 % på alla tider'] },
    ocrText: 'Är du överviktig? Börja spela golf',
  });
  const rules = r.findings.map((f) => f.rule);
  for (const id of ['superlativ', 'gratis', 'skiljetecken', 'prissankning', 'personliga_egenskaper']) assert.ok(rules.includes(id), id);
  assert.equal(r.status, 'fel');
  const pa = r.findings.find((f) => f.rule === 'personliga_egenskaper');
  assert.equal(pa.where, 'Text i bilden');
  assert.match(pa.quote, /överviktig/);
});

test('texter: varumärkets förbjudna ord och obligatoriska fraser', () => {
  const profile = { forbidden_words: ['billig'], required_phrases: ['Läs villkoren'] };
  const r = scanTexts({ texts: { bodies: ['En billig runda golf.'] }, profile });
  assert.ok(r.findings.some((f) => f.status === 'fel' && /billig/.test(f.title)));
  assert.ok(r.findings.some((f) => f.status === 'varning' && /Läs villkoren/.test(f.title)));
  // "billigare" är inte ordet "billig"
  assert.equal(scanTexts({ texts: { bodies: ['Billigare än du tror. Läs villkoren.'] }, profile }).status, 'ok');
});

test('texter: versaler och längd', () => {
  const r = scanTexts({ texts: { bodies: ['BOKA DIN TID IDAG HOS OSS', 'x'.repeat(130)], titles: ['y'.repeat(41)] } });
  assert.ok(r.findings.some((f) => f.rule === 'versaler'));
  assert.ok(r.findings.some((f) => f.rule === 'langd_text' && f.status === 'info'));
  assert.ok(r.findings.some((f) => f.rule === 'langd_rubrik'));
  assert.equal(scanTexts({}).status, 'info');
});

test('Advantage+: spärrad förbättring som är påslagen ger varning', () => {
  const features = featuresFromSpec({ creative_features_spec: {
    video_uncrop: { enroll_status: 'OPT_IN' }, enhance_cta: { enroll_status: 'OPT_IN' },
    image_uncrop: { enroll_status: 'OPT_OUT' }, okand_ny_funktion: { enroll_status: 'OPT_IN' },
  } });
  assert.deepEqual(features, { video_uncrop: 'OPT_IN', enhance_cta: 'OPT_IN', image_uncrop: 'OPT_OUT', okand_ny_funktion: 'OPT_IN' });
  const c = checkFeatures(features, DEFAULT_PROFILE.blocked_features);
  assert.equal(c.status, 'varning');
  assert.deepEqual(c.findings.map((f) => f.title), ['Videoexpansion (AI fyller ut videon)']);
  assert.ok(c.data.active.some((a) => a.label === 'Annan förbättring (okand_ny_funktion)'));
  assert.equal(checkFeatures({ enhance_cta: 'OPT_IN' }, DEFAULT_PROFILE.blocked_features).status, 'ok');
  assert.equal(checkFeatures(null).status, 'info');
});

test('domslut: fel ger Underkänd, varning eller manuell ger Granska, annars Godkänd', () => {
  const c = (status, extra = {}) => ({ key: status, label: 'K', status, summary: `s-${status}`, ...extra });
  assert.equal(verdictFor([c('ok'), c('info')]).verdict, 'godkand');
  assert.equal(verdictFor([c('ok'), c('manuell')]).verdict, 'granska');
  assert.match(verdictFor([c('ok'), c('manuell')]).reason, /bedömas manuellt/);
  assert.equal(verdictFor([c('varning'), c('ok')]).verdict, 'granska');
  const u = verdictFor([c('varning'), { key: 't', label: 'Texter', status: 'fel', summary: 'x', findings: [{ status: 'fel', title: 'Hälsopåstående' }] }]);
  assert.equal(u.verdict, 'underkand');
  assert.equal(u.reason, 'Texter: Hälsopåstående');
  const ranked = rankedFindings([c('ok'), c('varning'), { key: 't', label: 'T', status: 'fel', findings: [{ status: 'fel', title: 'a' }, { status: 'info', title: 'b' }] }]);
  assert.deepEqual(ranked.map((f) => f.status), ['fel', 'varning']);
});

// ── Bildbedömning (AI) ────────────────────────────────────────────────────
const VISION_OK = {
  logotyp: { status: 'ok', sakerhet: 'hog', kommentar: 'Logotypen är skarp och oförändrad.' },
  produktdetaljer: { status: 'ok', sakerhet: 'hog', kommentar: 'Golfsimulatorn ser korrekt ut.' },
  text_i_bild: { finns_text: true, text: 'Spela St Andrews på lunchen', lasbarhet: 'god', kommentar: 'Texten är tydlig.' },
  typsnitt: { status: 'matchar', observerat: 'fet sans-serif', sakerhet: 'medel', kommentar: 'Stämmer med varumärket.' },
  ai_artefakter: { status: 'inga', sakerhet: 'hog', kommentar: 'Inga spår.' },
};

test('AI-svaret blir kontroller med säkerhetsgrad, och text i bilden lämnas till reglerna', () => {
  const { checks, ocrText } = checksFromVision(VISION_OK, { hasLogo: true, hasFonts: true });
  assert.equal(ocrText, 'Spela St Andrews på lunchen');
  assert.deepEqual(checks.map((c) => c.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(checks.find((c) => c.key === 'typsnitt').confidence, 'medel');

  const low = checksFromVision({ ...VISION_OK, logotyp: { status: 'ok', sakerhet: 'lag', kommentar: 'Svår att se.' } }, { hasLogo: true });
  assert.equal(low.checks.find((c) => c.key === 'logotyp').status, 'varning', 'låg säkerhet räcker inte för ok');
  const bad = checksFromVision({ ...VISION_OK, ai_artefakter: { status: 'tydliga', sakerhet: 'hog', kommentar: 'Handen har sex fingrar.' } });
  assert.equal(bad.checks.find((c) => c.key === 'ai_artefakter').status, 'fel');
});

test('skymd logotyp och otydlig produkt är varningar, förvrängning är fel', () => {
  const st = (out, opts, key) => checksFromVision({ ...VISION_OK, ...out }, opts).checks.find((c) => c.key === key).status;
  assert.equal(st({ logotyp: { status: 'skymd', sakerhet: 'hog', kommentar: 'Delvis dold.' } }, { hasLogo: true }, 'logotyp'), 'varning');
  assert.equal(st({ logotyp: { status: 'forvrangd', sakerhet: 'hog', kommentar: 'Utdragen.' } }, { hasLogo: true }, 'logotyp'), 'fel');
  // utan logotyp i profilen: högst varning
  assert.equal(st({ logotyp: { status: 'forvrangd', sakerhet: 'hog', kommentar: 'Utdragen.' } }, { hasLogo: false }, 'logotyp'), 'varning');
  assert.equal(st({ produktdetaljer: { status: 'otydlig', sakerhet: 'hog', kommentar: 'Suddig.' } }, {}, 'produkt'), 'varning');
  assert.equal(st({ produktdetaljer: { status: 'forvrangd', sakerhet: 'hog', kommentar: 'Sex fingrar.' } }, {}, 'produkt'), 'fel');
});

test('videoomslag: modellen får veta att rörelseoskärpa är normalt', () => {
  const img = { buffer: Buffer.from('abc'), contentType: 'image/jpeg' };
  assert.match(buildRequest({ image: img, assetType: 'video' }).messages[0].content[0].text, /Rörelseoskärpa är normalt/);
  assert.doesNotMatch(buildRequest({ image: img }).messages[0].content[0].text, /Rörelseoskärpa/);
});

test('AI-kommentarer med siffror om andelar eller pengar ersätts', () => {
  const { checks } = checksFromVision({ ...VISION_OK, logotyp: { status: 'ok', sakerhet: 'hog', kommentar: 'Logotypen täcker 12 % av bilden.' } }, { hasLogo: true });
  assert.equal(checks.find((c) => c.key === 'logotyp').summary, 'Logotypen ser korrekt ut.');
});

test('utan typsnitt i profilen är typsnittet bara information', () => {
  const { checks } = checksFromVision({ ...VISION_OK, typsnitt: { status: 'avviker', observerat: 'skrivstil', sakerhet: 'hog', kommentar: 'x' } }, { hasFonts: false });
  const t = checks.find((c) => c.key === 'typsnitt');
  assert.equal(t.status, 'info');
  assert.match(t.summary, /skrivstil/);
});

test('anropet till Claude: strukturerat svar, bilder som base64, original vid variant', () => {
  const img = { buffer: Buffer.from('abc'), contentType: 'image/jpeg' };
  const req = buildRequest({ image: img, logos: [img], original: img, profile: { brand_name: 'TeeBox', fonts: ['Inter'] } });
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.ok(req.output_config.format.schema.required.includes('jamforelse'));
  assert.ok(!buildRequest({ image: img }).output_config.format.schema.required.includes('jamforelse'));
  assert.equal(req.tool_choice, undefined);
  const images = req.messages[0].content.filter((b) => b.type === 'image');
  assert.equal(images.length, 3);
  assert.equal(images[0].source.data, Buffer.from('abc').toString('base64'));
  assert.match(req.messages[0].content.at(-1).text, /TeeBox[\s\S]*Inter/);
  assert.equal(req.model, 'claude-opus-5-5');
});

test('schemat: alla objekt är slutna och alla fält krävs', () => {
  const walk = (o) => {
    if (o?.type === 'object') {
      assert.equal(o.additionalProperties, false);
      assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort());
      Object.values(o.properties).forEach(walk);
    }
  };
  walk(responseSchema({ withOriginal: true }));
});

test('svaret från Claude läses som JSON, och vägran eller trasigt svar ger fel', async () => {
  const img = { buffer: Buffer.from('abc'), contentType: 'image/jpeg' };
  const client = (content, stop_reason = 'end_turn') => ({ messages: { create: async () => ({ content, stop_reason, model: 'claude-opus-5-5' }) } });
  const r = await assessImage({ image: img }, { client: client([{ type: 'text', text: JSON.stringify(VISION_OK) }]) });
  assert.equal(r.output.logotyp.status, 'ok');
  await assert.rejects(assessImage({ image: img }, { client: client([{ type: 'text', text: 'inte json' }]) }), /inte gick att läsa/);
  await assert.rejects(assessImage({ image: img }, { client: client([], 'refusal') }), /inget svar/);
});

// ── Meta ──────────────────────────────────────────────────────────────────
const CREATIVE_AFS = {
  asset_feed_spec: {
    videos: [{ video_id: '111', thumbnail_url: 'https://x/t1.jpg' }, { video_id: '222' }],
    images: [{ hash: 'h1' }],
    bodies: [{ text: '' }, { text: 'Spela golf' }, { text: 'Spela golf' }],
    titles: [{ text: 'Rubrik' }],
    descriptions: [{ text: 'Västerås' }],
    call_to_action_types: ['BOOK_TRAVEL'],
  },
  degrees_of_freedom_spec: { creative_features_spec: { video_uncrop: { enroll_status: 'OPT_IN' } } },
};

test('texter och media ur annonsens material, utan dubbletter', () => {
  assert.deepEqual(textsFromCreative(CREATIVE_AFS), { bodies: ['Spela golf'], titles: ['Rubrik'], descriptions: ['Västerås'], cta: ['BOOK_TRAVEL'] });
  assert.deepEqual(mediaFromCreative(CREATIVE_AFS), { images: ['h1'], videos: ['111', '222'], fallbackUrl: null });
  const simple = { object_story_spec: { link_data: { message: 'Hej', name: 'R', image_hash: 'h9', call_to_action: { type: 'LEARN_MORE' } } } };
  assert.deepEqual(textsFromCreative(simple), { bodies: ['Hej'], titles: ['R'], descriptions: [], cta: ['LEARN_MORE'] });
  assert.deepEqual(mediaFromCreative({ image_url: 'https://x/a.jpg' }), { images: [], videos: [], fallbackUrl: 'https://x/a.jpg' });
});

test('aktiva annonser blir en granskning per bild och videoomslag', async () => {
  const calls = [];
  const get = async (path, params) => {
    calls.push({ path, params });
    if (path === 'act_1/ads') return { data: [{ id: 'ad1', name: 'TB_A1', effective_status: 'ACTIVE', campaign: { name: 'Kampanj' }, creative: CREATIVE_AFS }] };
    if (path === 'act_1/adimages') return { data: [{ hash: 'h1', url: 'https://cdn/h1.jpg' }] };
    if (path === '111') return { thumbnails: { data: [{ uri: 'https://cdn/111-small.jpg', width: 130 }, { uri: 'https://cdn/111.jpg', width: 1080, is_preferred: true }] } };
    if (path === '222') return { picture: 'https://cdn/222.jpg' };
    throw new Error(`oväntat anrop ${path}`);
  };
  const items = await collectAssets('act_1', 'token', { get });
  assert.deepEqual(items.map((i) => [i.asset_key, i.asset_type, i.source_url]), [
    ['img:h1', 'bild', 'https://cdn/h1.jpg'],
    ['vid:111', 'video', 'https://cdn/111.jpg'],
    ['vid:222', 'video', 'https://cdn/222.jpg'],
  ]);
  assert.equal(items[0].features.video_uncrop, 'OPT_IN');
  assert.equal(items[0].campaign_name, 'Kampanj');
  assert.deepEqual(calls[0].params.filtering, [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]);
  // samma innehåll ger samma nyckel, ändrad text ger ny
  const k1 = contentKey({ assetKey: 'vid:111', texts: items[1].texts, features: items[1].features });
  assert.equal(k1, items[1].content_key);
  assert.notEqual(k1, contentKey({ assetKey: 'vid:111', texts: { ...items[1].texts, bodies: ['Ny text'] }, features: items[1].features }));
});

// ── Hela granskningen ─────────────────────────────────────────────────────
function memoryStore({ profile = {}, files = {}, reviews = {} } = {}) {
  const saved = { ...files };
  return {
    saved,
    getProfile: async () => ({ ...DEFAULT_PROFILE, ...profile }),
    getReview: async (id) => reviews[id] || null,
    upload: async (path, buf) => { saved[path] = buf; return path; },
    download: async (path) => { if (!saved[path]) throw new Error('saknas'); return saved[path]; },
  };
}

const REVIEW = {
  id: 7, user_id: 6, asset_type: 'video', source_url: 'https://cdn/111.jpg?oh=hemligt',
  texts: { bodies: ['Spela golf i Västerås'], titles: ['200 banor'], descriptions: [], cta: [] },
  features: { video_uncrop: 'OPT_OUT', enhance_cta: 'OPT_IN' },
};

test('granskning med AI: bilden sparas, kontroller körs och domslutet blir Godkänd', async () => {
  const img = makeJpeg(1080, 1920, CYAN, GRAY);
  const store = memoryStore({ profile: { palette: [{ hex: '#00d9ff', name: 'Cyan' }], fonts: ['Inter'] } });
  let asked;
  const patch = await runReview(REVIEW, {
    store,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => img }),
    vision: { available: true, assess: async (args) => { asked = args; return { output: VISION_OK, model: 'claude-opus-5-5' }; } },
  });
  assert.equal(patch.status, 'klar');
  assert.equal(patch.verdict, 'godkand', JSON.stringify(patch.checks.filter((c) => c.status !== 'ok' && c.status !== 'info')));
  assert.equal(patch.ai_model, 'claude-opus-5-5');
  assert.equal(patch.source_url, null);
  assert.match(patch.image_path, /^reviews\/6\/[0-9a-f]{64}\.jpg$/);
  assert.ok(store.saved[patch.image_path]);
  assert.equal(asked.image.contentType, 'image/jpeg');
  assert.deepEqual(patch.checks.map((c) => c.key), ['logotyp', 'produkt', 'typsnitt', 'ai_artefakter', 'text_i_bild', 'texter', 'format', 'farger', 'advantage']);
});

test('text som AI läser ur bilden granskas av reglerna', async () => {
  const img = makeJpeg(1080, 1080, CYAN, GRAY);
  const patch = await runReview({ ...REVIEW, asset_type: 'bild' }, {
    store: memoryStore(),
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => img }),
    vision: { available: true, assess: async () => ({ output: { ...VISION_OK, text_i_bild: { finns_text: true, text: 'Botar ryggont!', lasbarhet: 'god', kommentar: 'Tydlig.' } }, model: 'm' }) },
  });
  assert.equal(patch.verdict, 'underkand');
  assert.match(patch.verdict_reason, /Hälsopåstående/);
});

test('utan AI blir bildkontrollerna manuella och domslutet Granska', async () => {
  const img = makePng(1080, 1080, CYAN, GRAY);
  const patch = await runReview({ ...REVIEW, asset_type: 'bild' }, {
    store: memoryStore({ profile: { palette: [{ hex: '#00d9ff' }] } }),
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => img }),
    vision: { available: false },
  });
  assert.equal(patch.verdict, 'granska');
  assert.equal(patch.ai_model, null);
  assert.equal(patch.checks.find((c) => c.key === 'logotyp').status, 'manuell');
});

test('misslyckad AI-bedömning ger manuella kontroller, inte en trasig granskning', async () => {
  const img = makePng(1080, 1080, CYAN, GRAY);
  const patch = await runReview({ ...REVIEW, asset_type: 'bild' }, {
    store: memoryStore(),
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => img }),
    vision: { available: true, assess: async () => { throw new Error('529 overloaded https://api.example/x'); } },
  });
  assert.equal(patch.status, 'klar');
  assert.equal(patch.verdict, 'granska');
  const logo = patch.checks.find((c) => c.key === 'logotyp');
  assert.match(logo.summary, /misslyckades/);
  assert.doesNotMatch(logo.data.error, /https?:/);
});

test('variant jämförs med originalet', async () => {
  const img = makePng(1080, 1080, CYAN, GRAY);
  const store = memoryStore({ files: { 'reviews/6/orig.png': img, 'reviews/6/var.png': img }, reviews: { 1: { id: 1, image_path: 'reviews/6/orig.png' } } });
  let asked;
  const patch = await runReview({ ...REVIEW, asset_type: 'bild', source_url: null, image_path: 'reviews/6/var.png', original_review_id: 1 }, {
    store,
    vision: { available: true, assess: async (a) => { asked = a; return { output: { ...VISION_OK, jamforelse: { status: 'avviker', sakerhet: 'hog', kommentar: 'Logotypen har bytt färg.' } }, model: 'm' }; } },
  });
  assert.ok(asked.original);
  assert.equal(patch.checks.find((c) => c.key === 'jamforelse').status, 'fel');
  assert.equal(patch.verdict, 'underkand');
});

test('trasig bildhämtning ger fel, och felmeddelanden saknar adresser och token', async () => {
  await assert.rejects(runReview(REVIEW, { store: memoryStore(), fetchImpl: async () => ({ ok: false, status: 403 }), vision: { available: false } }), /HTTP 403/);
  assert.equal(redact('fel vid https://graph.facebook.com/x?access_token=EAAB123'), 'fel vid [adress]');
});

// ── Övrigt ────────────────────────────────────────────────────────────────
test('interna anrop: signatur, utgång och manipulation', () => {
  const now = 1_800_000_000_000;
  const sig = signInternal('hemlig', now);
  assert.equal(verifyInternal(sig, 'hemlig', now + 60000), true);
  assert.equal(verifyInternal(sig, 'hemlig', now + 6 * 60000), false);
  assert.equal(verifyInternal(sig, 'annan', now), false);
  assert.equal(verifyInternal(`${now + 1}.${sig.split('.')[1]}`, 'hemlig', now), false);
  assert.equal(verifyInternal(undefined, 'hemlig', now), false);
  assert.equal(verifyInternal('x.y', 'hemlig', now), false);
});

test('varumärkesprofilen valideras och rensas', () => {
  const p = normalizeProfile({
    brand_name: '  TeeBox ', ad_account_ids: '1275710539563429, act_18453645',
    palette: [{ hex: '#00D9FF', name: 'Cyan' }], fonts: 'Syne\nInter\nInter',
    forbidden_words: ['billig', ' billig '], blocked_features: ['image_uncrop'], okänt_fält: 'ignoreras',
  });
  assert.deepEqual(p, {
    brand_name: 'TeeBox', ad_account_ids: ['act_1275710539563429', 'act_18453645'],
    palette: [{ hex: '#00d9ff', name: 'Cyan' }], fonts: ['Syne', 'Inter'],
    forbidden_words: ['billig'], blocked_features: ['image_uncrop'],
  });
  assert.throws(() => normalizeProfile({ palette: [{ hex: 'blå' }] }), ProfileInvalid);
  assert.throws(() => normalizeProfile({ ad_account_ids: ['konto1'] }), /Ogiltigt annonskonto/);
});

test('senaste granskningen per annons och bild visas, äldre är historik', () => {
  const rows = [
    { id: 3, ad_id: 'a', asset_key: 'vid:1' }, { id: 2, ad_id: 'a', asset_key: 'vid:1' },
    { id: 1, ad_id: 'a', asset_key: 'vid:2' }, { id: 9, ad_id: null, asset_key: 'upl:x' },
  ];
  assert.deepEqual(latestPerAsset(rows).map((r) => r.id), [3, 1, 9]);
});

test('manuella kontroller utan AI', () => {
  assert.deepEqual(manualChecks().map((c) => c.status), ['manuell', 'manuell', 'manuell', 'manuell', 'manuell']);
  assert.equal(manualChecks({ hasOriginal: true }).length, 6);
});
