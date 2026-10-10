/**
 * Admiral Modul B — regelbaserade kontroller för granskning av annonsmaterial.
 *
 * Allt här är deterministiskt: format, färger, texter (policy och lag) och Advantage+-inställningar.
 * Alla siffror räknas fram här, aldrig av en språkmodell.
 *
 * En kontroll: { key, label, status, summary, findings?, data?, by }
 *   status: ok | info | varning | fel | manuell
 *   info påverkar inte domslutet. manuell betyder att en människa måste bedöma.
 */

export const STATUS_RANK = { ok: 0, info: 0, manuell: 1, varning: 2, fel: 3 };
export const VERDICT_LABEL = { godkand: 'Godkänd', granska: 'Granska', underkand: 'Underkänd' };

const pct = (x) => `${(Math.round(x * 1000) / 10).toLocaleString('sv-SE')} %`;
const px = (n) => `${n.toLocaleString('sv-SE')} px`;

// ── Format ────────────────────────────────────────────────────────────────
export const FORMATS = [
  { name: 'Kvadrat 1:1', ratio: 1 },
  { name: 'Stående 4:5', ratio: 4 / 5 },
  { name: 'Helskärm 9:16', ratio: 9 / 16 },
  { name: 'Liggande 1,91:1', ratio: 1.91 },
  { name: 'Liggande 16:9', ratio: 16 / 9 },
];
const RATIO_TOLERANCE = 0.03;
export const MIN_WIDTH = 600;
export const RECOMMENDED_WIDTH = 1080;

export function checkFormat({ width, height, assetType }) {
  const base = { key: 'format', label: 'Format', by: 'regler' };
  if (!width || !height) return { ...base, status: 'manuell', summary: 'Bildens mått gick inte att läsa.' };
  const ratio = width / height;
  const match = FORMATS.find((f) => Math.abs(ratio - f.ratio) / f.ratio <= RATIO_TOLERANCE);
  const findings = [];
  const shortSide = Math.min(width, height);
  if (shortSide < MIN_WIDTH) {
    findings.push({ status: 'fel', title: 'För låg upplösning', detail: `Kortaste sidan är ${px(shortSide)}. Meta kräver minst ${px(MIN_WIDTH)}.` });
  } else if (shortSide < RECOMMENDED_WIDTH) {
    findings.push({ status: 'varning', title: 'Låg upplösning', detail: `Kortaste sidan är ${px(shortSide)}. Meta rekommenderar minst ${px(RECOMMENDED_WIDTH)}.` });
  }
  if (!match) {
    findings.push({ status: 'varning', title: 'Ovanligt format', detail: `${px(width)} × ${px(height)} passar inget av Metas standardformat, så Meta beskär bilden.` });
  }
  const status = worst(findings.map((f) => f.status));
  const what = assetType === 'video' ? 'Videon' : 'Bilden';
  return {
    ...base,
    status,
    summary: match ? `${what} är ${match.name}, ${px(width)} × ${px(height)}.` : `${what} är ${px(width)} × ${px(height)}.`,
    findings,
    data: { width, height, format: match?.name || null },
  };
}

// ── Färger ────────────────────────────────────────────────────────────────
const GRID = 120; // bilden samplas i högst 120 × 120 punkter
const BRAND_DELTA_E = 12; // så nära räknas som varumärkesfärgen
const MERGE_DELTA_E = 10;
export const BRAND_COLOR_MIN_SHARE = 0.01;

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function rgbToLab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// CIEDE2000
export function deltaE([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (b === 0 && a === 0) return 0; const v = Math.atan2(b, a) / rad; return v >= 0 ? v : v + 360; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hm += h1p + h2p < 360 ? 360 : -360; hm /= 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// Samplar bilden i ett rutnät. Ger färger med andel av ytan.
export function samplePixels({ width, height, data }) {
  const stepX = Math.max(1, Math.floor(width / GRID));
  const stepY = Math.max(1, Math.floor(height / GRID));
  const out = [];
  for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
    for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue; // genomskinligt
      out.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  return out;
}

export function dominantColors(pixels, max = 6) {
  const buckets = new Map();
  for (const [r, g, b] of pixels) {
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.r += r; e.g += g; e.b += b;
    buckets.set(k, e);
  }
  const sorted = [...buckets.values()].map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n], n: e.n })).sort((a, b) => b.n - a.n);
  const merged = [];
  for (const c of sorted) {
    const lab = rgbToLab(c.rgb);
    const near = merged.find((m) => deltaE(m.lab, lab) < MERGE_DELTA_E);
    if (near) near.n += c.n;
    else merged.push({ ...c, lab });
  }
  const total = pixels.length || 1;
  return merged.sort((a, b) => b.n - a.n).slice(0, max).map((m) => ({ hex: rgbToHex(m.rgb), share: m.n / total }));
}

export function checkColors(image, palette = []) {
  const base = { key: 'farger', label: 'Färger', by: 'regler' };
  if (!image?.data) return { ...base, status: 'manuell', summary: 'Färgerna gick inte att läsa ur det här bildformatet.' };
  const pixels = samplePixels(image);
  const dominant = dominantColors(pixels);
  const brand = (palette || []).map((p) => ({ ...p, rgb: hexToRgb(p.hex) })).filter((p) => p.rgb);
  if (!brand.length) {
    return { ...base, status: 'info', summary: 'Varumärkesprofilen saknar färger, så färgerna jämförs inte.', data: { dominant, brand: [] } };
  }
  const labs = pixels.map(rgbToLab);
  const brandShares = brand.map((p) => {
    const lab = rgbToLab(p.rgb);
    const n = labs.reduce((s, l) => s + (deltaE(l, lab) <= BRAND_DELTA_E ? 1 : 0), 0);
    return { hex: p.hex.toLowerCase(), name: p.name || p.hex, share: n / (labs.length || 1) };
  });
  const seen = brandShares.filter((b) => b.share >= BRAND_COLOR_MIN_SHARE).sort((a, b) => b.share - a.share);
  if (!seen.length) {
    return {
      ...base, status: 'varning',
      summary: 'Inga av varumärkets färger syns i bilden.',
      findings: [{ status: 'varning', title: 'Varumärkets färger saknas', detail: 'Ingen av färgerna i varumärkesprofilen täcker minst 1 % av bilden.' }],
      data: { dominant, brand: brandShares },
    };
  }
  return {
    ...base, status: 'ok',
    summary: `Varumärkets färger syns: ${seen.slice(0, 3).map((b) => `${b.name} (${pct(b.share)})`).join(', ')}.`,
    data: { dominant, brand: brandShares },
  };
}

// ── Texter: Metas annonsregler och svensk marknadsföringslag ──────────────
// Varje regel ger ett fynd med förklaring. Reglerna flaggar det som behöver kontrolleras;
// en människa avgör om påståendet håller.
const W = '[a-zåäöéü0-9]';
const word = (alts) => new RegExp(`(?<!${W})(?:${alts})(?!${W})`, 'iu');

export const TEXT_RULES = [
  {
    id: 'personliga_egenskaper', status: 'fel', title: 'Antyder personliga egenskaper',
    detail: 'Meta tillåter inte text som påstår eller antyder något om mottagarens hälsa, ekonomi, sexuella läggning, religion eller liknande.',
    re: /(?<![a-zåäö])(är du|har du|lider du av|känner du dig|du som är)\s(?:[^.!?]{0,40}?)(?<![a-zåäö])(överviktig|tjock|deprimerad|ensam|skuldsatt|singel|sjuk|diabetiker|gravid|arbetslös|ångest|homosexuell|gay|muslim|kristen|jude|handikappad|funktionsnedsatt)(?![a-zåäö])/iu,
  },
  {
    id: 'halsopastaende', status: 'fel', title: 'Hälsopåstående',
    detail: 'Påståenden om att något botar, läker eller ger viktnedgång är inte tillåtna i annonser utan godkänd grund.',
    re: word('botar|bota|läker|garanterad viktnedgång|gå ner \\d+ ?kg|tappa \\d+ ?kg|bränner fett'),
  },
  {
    id: 'superlativ', status: 'varning', title: 'Absolut påstående',
    detail: 'Ord som "bäst", "billigast" och "marknadens lägsta" måste kunna bevisas enligt marknadsföringslagen.',
    re: word('bäst|billigast|billigaste|marknadens (?:lägsta|bästa|största|billigaste)|sveriges (?:bästa|största|billigaste)|nummer ett|nr 1|#1|ledande|störst i sverige'),
  },
  {
    id: 'garanti', status: 'varning', title: 'Garanti eller löfte',
    detail: 'Garantier och löften om resultat måste stämma och villkoren måste framgå.',
    re: word('garanterat|garanterad|garanterar|100 ?% (?:säker|nöjd|garanti|resultat)|riskfritt'),
  },
  {
    id: 'gratis', status: 'varning', title: 'Gratis',
    detail: '"Gratis" får bara användas om kunden inte måste köpa något annat eller betala dolda avgifter.',
    re: word('gratis|kostnadsfri|kostnadsfritt|kostnadsfria|helt gratis'),
  },
  {
    id: 'prissankning', status: 'varning', title: 'Prissänkning',
    detail: 'Vid en prissänkning måste det lägsta priset under de senaste 30 dagarna anges (prisinformationslagen).',
    re: word('rea|reapris|nedsatt|sänkt pris|prissänkt|rabatt|spara \\d+|tidigare pris|ordinarie pris|ord\\. pris|ord pris|-\\d+ ?%|\\d+ ?% rabatt|halva priset'),
  },
  {
    id: 'miljo', status: 'varning', title: 'Miljöpåstående',
    detail: 'Miljöpåståenden som "klimatneutral" och "miljövänlig" måste vara specifika och kunna bevisas.',
    re: word('miljövänlig|miljövänligt|miljövänliga|klimatneutral|klimatneutralt|klimatsmart|klimatkompenserad|koldioxidneutral|hållbar|hållbart|grönt val|eko-?vänlig'),
  },
  {
    id: 'bradska', status: 'varning', title: 'Brådska',
    detail: 'Påståenden om att erbjudandet snart tar slut måste vara sanna.',
    re: word('endast idag|bara idag|sista chansen|nästan slutsåld|nästan slutsålt|få platser kvar|bara några kvar'),
  },
  {
    id: 'fore_efter', status: 'varning', title: 'Före och efter',
    detail: 'Meta begränsar bilder och texter som jämför före och efter, särskilt om kropp och hälsa.',
    re: /(?<![a-zåäö])före\s*(?:och|\/|&|-)\s*efter(?![a-zåäö])/iu,
  },
  {
    id: 'engagemang', status: 'varning', title: 'Uppmaning att gilla eller dela',
    detail: 'Meta visar annonser som ber om gillningar, delningar eller taggningar för färre personer.',
    re: word('gilla och dela|dela om|gilla om|tagga en vän|tagga någon|kommentera ja|skriv ja'),
  },
];

const CAPS_MIN_LETTERS = 12;
const CAPS_SHARE = 0.5;
export const PRIMARY_TEXT_VISIBLE = 125;
export const HEADLINE_VISIBLE = 40;

function textUnits(texts = {}, ocrText = '') {
  const units = [];
  for (const t of texts.bodies || []) if (t) units.push({ where: 'Annonstext', text: t });
  for (const t of texts.titles || []) if (t) units.push({ where: 'Rubrik', text: t });
  for (const t of texts.descriptions || []) if (t) units.push({ where: 'Beskrivning', text: t });
  if (ocrText) units.push({ where: 'Text i bilden', text: ocrText });
  return units;
}

const quote = (text, index, length) => {
  const start = Math.max(0, index - 25);
  const end = Math.min(text.length, index + length + 25);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
};

export function scanTexts({ texts = {}, ocrText = '', profile = {} } = {}) {
  const base = { key: 'texter', label: 'Texter, policy och lag', by: 'regler' };
  const units = textUnits(texts, ocrText);
  if (!units.length) return { ...base, status: 'info', summary: 'Annonsen har inga texter att granska.', findings: [] };

  const findings = [];
  const seen = new Set();
  const add = (f) => {
    const k = `${f.rule}|${f.where}`;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push(f);
  };

  for (const u of units) {
    for (const rule of TEXT_RULES) {
      const m = rule.re.exec(u.text);
      if (m) add({ rule: rule.id, status: rule.status, title: rule.title, detail: rule.detail, where: u.where, quote: quote(u.text, m.index, m[0].length) });
    }
    for (const w of profile.forbidden_words || []) {
      const term = String(w).trim();
      if (!term) continue;
      const re = new RegExp(`(?<!${W})${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!${W})`, 'iu');
      const m = re.exec(u.text);
      if (m) add({ rule: `forbjudet:${term.toLowerCase()}`, status: 'fel', title: `Förbjudet ord: "${term}"`, detail: 'Ordet finns i varumärkets lista över ord som inte får användas.', where: u.where, quote: quote(u.text, m.index, m[0].length) });
    }
    const letters = u.text.match(/\p{L}/gu) || [];
    const upper = u.text.match(/\p{Lu}/gu) || [];
    if (u.where !== 'Text i bilden' && letters.length >= CAPS_MIN_LETTERS && upper.length / letters.length > CAPS_SHARE) {
      add({ rule: 'versaler', status: 'varning', title: 'Mycket versaler', detail: 'Meta begränsar annonser där texten mest består av versaler.', where: u.where, quote: quote(u.text, 0, 30) });
    }
    if (/[!?]{3,}/.test(u.text)) {
      add({ rule: 'skiljetecken', status: 'varning', title: 'Upprepade utrops- eller frågetecken', detail: 'Meta begränsar annonser med upprepade skiljetecken.', where: u.where, quote: quote(u.text, u.text.search(/[!?]{3,}/), 3) });
    }
  }

  const allText = units.map((u) => u.text).join('\n');
  for (const p of profile.required_phrases || []) {
    const phrase = String(p).trim();
    if (phrase && !allText.toLowerCase().includes(phrase.toLowerCase())) {
      add({ rule: `kravs:${phrase.toLowerCase()}`, status: 'varning', title: `Saknar "${phrase}"`, detail: 'Texten finns i varumärkets lista över det som alltid ska finnas med.', where: 'Hela annonsen' });
    }
  }

  const longBodies = (texts.bodies || []).filter((t) => t && t.length > PRIMARY_TEXT_VISIBLE).length;
  if (longBodies) add({ rule: 'langd_text', status: 'info', title: 'Lång annonstext', detail: `${longBodies} annonstext${longBodies > 1 ? 'er' : ''} är längre än ${PRIMARY_TEXT_VISIBLE} tecken och kortas med "Visa mer" i flödet.`, where: 'Annonstext' });
  const longTitles = (texts.titles || []).filter((t) => t && t.length > HEADLINE_VISIBLE).length;
  if (longTitles) add({ rule: 'langd_rubrik', status: 'info', title: 'Lång rubrik', detail: `${longTitles} rubrik${longTitles > 1 ? 'er' : ''} är längre än ${HEADLINE_VISIBLE} tecken och kan kortas av.`, where: 'Rubrik' });

  const status = worst(findings.map((f) => f.status));
  const serious = findings.filter((f) => STATUS_RANK[f.status] >= STATUS_RANK.varning).length;
  return {
    ...base,
    status,
    summary: serious ? `${serious} sak${serious > 1 ? 'er' : ''} att kontrollera i texterna.` : 'Inga problem hittades i texterna.',
    findings,
  };
}

// ── Advantage+-förbättringar ──────────────────────────────────────────────
export const FEATURE_LABELS = {
  standard_enhancements: 'Standardförbättringar (paket)',
  advantage_plus_creative: 'Advantage+ kreativ (paket)',
  text_optimizations: 'Meta byter plats på och kortar texter',
  text_generation: 'Meta skriver nya texter med AI',
  description_automation: 'Meta skriver beskrivningen',
  text_translation: 'Meta översätter texter',
  enhance_cta: 'Meta byter knapptext',
  inline_comment: 'Visar en relevant kommentar under annonsen',
  pac_relaxation: 'Meta väljer material per placering',
  adapt_to_placement: 'Bilden anpassas till placeringen',
  image_touchups: 'Automatisk beskärning och justering av bild',
  image_brightness_and_contrast: 'Justerar ljusstyrka och kontrast',
  image_uncrop: 'Bildexpansion (AI fyller ut bilden)',
  video_uncrop: 'Videoexpansion (AI fyller ut videon)',
  image_background_gen: 'AI-genererad bakgrund',
  image_templates: 'Bilden läggs i en mall med text',
  add_text_overlay: 'Text läggs ovanpå bilden',
  image_animation: 'Stillbilden animeras',
  multi_photo_to_video: 'Flera bilder görs om till video',
  cv_transformation: 'Bilden omvandlas med AI',
  video_auto_crop: 'Videon beskärs automatiskt',
  video_filtering: 'Videofilter',
  ig_video_native_subtitle: 'Automatiska undertexter på Instagram',
  music: 'Musik läggs till',
  show_destination_blurbs: 'Visar korta texter från webbplatsen',
  site_extensions: 'Visar länkar till fler sidor på webbplatsen',
  product_extensions: 'Visar produkter från katalogen',
  product_browsing: 'Kunden kan bläddra bland produkter',
  reveal_details_over_time: 'Mer information visas efter en stund',
  show_summary: 'Visar en sammanfattning av annonsen',
  ads_with_benefits: 'Visar erbjudanden och förmåner',
  profile_card: 'Visar profilkort',
  media_type_automation: 'Meta väljer mellan bild och video',
};
export const featureLabel = (k) => FEATURE_LABELS[k] || `Annan förbättring (${k})`;

// { feature: 'OPT_IN' | 'OPT_OUT' } ur degrees_of_freedom_spec.creative_features_spec
export function featuresFromSpec(dof) {
  const spec = dof?.creative_features_spec || {};
  return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v?.enroll_status || null]).filter(([, v]) => v));
}

export function checkFeatures(features, blocked = []) {
  const base = { key: 'advantage', label: 'Advantage+-förbättringar', by: 'regler' };
  if (!features) return { ...base, status: 'info', summary: 'Gäller bara annonser som ligger i Meta.', data: { active: [] } };
  const active = Object.entries(features).filter(([, v]) => v === 'OPT_IN').map(([k]) => k);
  const blockedOn = active.filter((k) => blocked.includes(k));
  const findings = blockedOn.map((k) => ({
    status: 'varning', title: featureLabel(k),
    detail: 'Förbättringen är påslagen men står som inte tillåten i varumärkesprofilen. Meta kan ändra bilden eller texten så att den avviker från varumärket.',
  }));
  return {
    ...base,
    status: blockedOn.length ? 'varning' : 'ok',
    summary: blockedOn.length
      ? `${blockedOn.length} förbättring${blockedOn.length > 1 ? 'ar' : ''} som inte är tillåten${blockedOn.length > 1 ? 'a' : ''} är påslagen${blockedOn.length > 1 ? 'a' : ''}.`
      : active.length ? `${active.length} förbättringar är påslagna, ingen av dem är spärrad i varumärkesprofilen.` : 'Inga förbättringar är påslagna.',
    findings,
    data: { active: active.map((k) => ({ key: k, label: featureLabel(k), blocked: blocked.includes(k) })) },
  };
}

// ── Domslut ───────────────────────────────────────────────────────────────
export function worst(statuses) {
  return statuses.reduce((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), 'ok');
}

export function verdictFor(checks) {
  const statuses = checks.flatMap((c) => [c.status, ...(c.findings || []).map((f) => f.status)]);
  const w = worst(statuses);
  const verdict = w === 'fel' ? 'underkand' : w === 'ok' ? 'godkand' : 'granska';
  const first = (s) => checks.flatMap((c) => (c.findings?.length ? c.findings.map((f) => ({ ...f, label: c.label })) : [{ status: c.status, title: c.summary, label: c.label }])).find((f) => f.status === s);
  let reason;
  if (verdict === 'underkand') reason = `${first('fel').label}: ${first('fel').title}`;
  else if (verdict === 'granska') {
    const f = first('varning') || first('manuell');
    reason = f.status === 'manuell' ? `${f.label} behöver bedömas manuellt.` : `${f.label}: ${f.title}`;
  } else reason = 'Inga avvikelser hittades.';
  return { verdict, reason };
}

// Fynd i ordning efter allvar, för kolumnen (högst 3 synliga, resten bakom "Visa fler").
export function rankedFindings(checks) {
  const all = checks.flatMap((c) => (c.findings?.length
    ? c.findings.map((f) => ({ ...f, check: c.key, label: c.label }))
    : STATUS_RANK[c.status] >= STATUS_RANK.manuell ? [{ status: c.status, title: c.summary, check: c.key, label: c.label, confidence: c.confidence }] : []));
  return all.filter((f) => STATUS_RANK[f.status] >= STATUS_RANK.manuell).sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);
}
