/**
 * Admiral Modul E — Admirals egna varianter: nya annonstexter till samma bild eller video.
 *
 * Claude skriver texterna utifrån originalet och kundens varumärkesprofil (ton, förbjudna ord,
 * fraser som måste finnas med). Koden släpper bara igenom varianter som:
 *   - inte innehåller siffror som saknas i originalet (inga nya priser, mängder eller påståenden),
 *   - inte innehåller förbjudna ord, och har med fraserna som måste finnas,
 *   - håller sig inom längdgränserna och skiljer sig från originalet.
 * Varje variant granskas sedan i Modul B innan den kan bli ett förslag.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL } from './review-vision.js';

export const MAX_BODY = 300;
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 90;

const SYSTEM = [
  'Du skriver annonstexter för Meta-annonser åt Admiral, en tjänst för små svenska företag. Skriv på samma språk som originalet.',
  'Annonsen har visats länge och publiken har tröttnat. Skriv nya versioner med en ny vinkel eller ny inledning,',
  'men med samma erbjudande, samma fakta och samma uppmaning som originalet.',
  'Hitta inte på något: inga nya priser, siffror, rabatter, garantier eller påståenden som inte står i originalet.',
  'Använd inte superlativ som "bäst" eller "billigast", och skriv inte "gratis" om det inte står i originalet.',
  'Fråga aldrig om mottagarens hälsa, ekonomi eller andra personliga egenskaper. Inga versaler för betoning, inga upprepade utropstecken.',
  'Svara bara med JSON enligt schemat.',
].join(' ');

const part = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });

export function variantSchema() {
  return part({
    varianter: {
      type: 'array',
      items: part({
        vinkel: { type: 'string', description: 'Kort beskrivning av den nya vinkeln, på svenska (visas för Fabricken).' },
        annonstext: { type: 'string', description: `Primär text, högst ${MAX_BODY} tecken.` },
        rubrik: { type: 'string', description: `Rubrik, högst ${MAX_TITLE} tecken.` },
        beskrivning: { type: 'string', description: `Beskrivning, högst ${MAX_DESCRIPTION} tecken. Tom sträng om originalet saknar beskrivning.` },
      }),
    },
  });
}

export function buildCopyRequest({ texts = {}, profile = {}, count = 2, model = DEFAULT_MODEL }) {
  const lines = [
    'Originalets texter:',
    ...(texts.bodies || []).map((t) => `Annonstext: ${t}`),
    ...(texts.titles || []).map((t) => `Rubrik: ${t}`),
    ...(texts.descriptions || []).map((t) => `Beskrivning: ${t}`),
    '',
    profile.brand_name ? `Varumärke: ${profile.brand_name}` : null,
    profile.tone_notes ? `Ton: ${profile.tone_notes}` : null,
    profile.forbidden_words?.length ? `Ord som inte får användas: ${profile.forbidden_words.join(', ')}` : null,
    profile.required_phrases?.length ? `Måste finnas med ordagrant: ${profile.required_phrases.join(', ')}` : null,
    '',
    `Skriv ${count} varianter som skiljer sig tydligt från originalet och från varandra.`,
  ].filter((l) => l !== null);
  return {
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: variantSchema() } },
    messages: [{ role: 'user', content: lines.join('\n') }],
  };
}

const numbersIn = (s) => (String(s).match(/\d+(?:[.,\s]\d+)*/g) || []).map((n) => n.replace(/[\s.,]/g, ''));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Kontrollerar en variant. Returnerar en lista med skäl att stoppa den (tom = godkänd).
export function validateVariant(v, { texts = {}, profile = {} } = {}) {
  const errors = [];
  const original = [...(texts.bodies || []), ...(texts.titles || []), ...(texts.descriptions || [])].join('\n');
  const allowed = new Set(numbersIn(original));
  const all = [v.body, v.title, v.description].join('\n');
  const invented = numbersIn(all).filter((n) => !allowed.has(n));
  if (invented.length) errors.push(`Siffror som inte finns i originalet: ${[...new Set(invented)].join(', ')}`);
  if (!v.body) errors.push('Annonstext saknas');
  if (v.body.length > MAX_BODY) errors.push('Annonstexten är för lång');
  if (!v.title) errors.push('Rubrik saknas');
  if (v.title.length > MAX_TITLE) errors.push('Rubriken är för lång');
  if (v.description.length > MAX_DESCRIPTION) errors.push('Beskrivningen är för lång');
  const lower = all.toLowerCase();
  for (const w of profile.forbidden_words || []) if (w && lower.includes(String(w).toLowerCase())) errors.push(`Förbjudet ord: ${w}`);
  for (const p of profile.required_phrases || []) if (p && !lower.includes(String(p).toLowerCase())) errors.push(`Saknar: ${p}`);
  if ((texts.bodies || []).some((b) => norm(b) === v.body) && (texts.titles || []).some((t) => norm(t) === v.title)) errors.push('Samma som originalet');
  return errors;
}

export async function generateCopyVariants({ texts, profile, count = 2, client, model, attempts = 2 }) {
  if (!count) return { variants: [], rejected: [] };
  const anthropic = client || new Anthropic();
  const req = buildCopyRequest({ texts, profile, count, model: model || process.env.ADMIRAL_VISION_MODEL || DEFAULT_MODEL });
  const variants = [];
  const rejected = [];
  let usedModel = req.model;
  // Ett nytt försök om inget textförslag klarar kontrollen (eller svaret inte gick att läsa).
  for (let i = 0; i < attempts && !variants.length; i += 1) {
    const msg = await anthropic.messages.create(req);
    usedModel = msg.model || req.model;
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let out = null;
    try { out = text && msg.stop_reason !== 'refusal' ? JSON.parse(text) : null; } catch { out = null; }
    if (!out) {
      if (i === attempts - 1) throw new Error('Textförslagen gav inget svar som gick att läsa');
      continue;
    }
    for (const raw of (out.varianter || []).slice(0, count)) {
      const v = { body: norm(raw.annonstext), title: norm(raw.rubrik), description: norm(raw.beskrivning), angle: norm(raw.vinkel).slice(0, 120) };
      const errors = validateVariant(v, { texts, profile });
      (errors.length ? rejected : variants).push(errors.length ? { ...v, errors } : v);
    }
  }
  return { variants, rejected, model: usedModel };
}
