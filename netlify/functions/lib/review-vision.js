/**
 * Admiral Modul B — bildbedömning med Claude (via Netlify AI Gateway).
 *
 * Modellen bedömer det som inte går att räkna fram: logotyp, produktdetaljer, text i bilden,
 * typsnitt och spår av AI-redigering. Den svarar bara med kategorier och en kort kommentar,
 * aldrig med siffror om andelar, mått eller pengar. Texten den läser ur bilden granskas sedan
 * av samma regler som annonstexterna (review-rules.js).
 *
 * Utan AI (ingen ANTHROPIC_API_KEY i miljön) blir kontrollerna "manuell": en människa bedömer.
 */
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const visionAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

const CONF = { hog: 'hög', medel: 'medel', lag: 'låg' };
const confEnum = { type: 'string', enum: ['hog', 'medel', 'lag'] };
const comment = { type: 'string', description: 'En mening på svenska. Inga siffror om andelar, mått eller pengar.' };

const part = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });

// JSON-schema för svaret (strukturerade svar). jamforelse finns bara med när ett original skickas.
export function responseSchema({ withOriginal = false } = {}) {
  const props = {
    logotyp: part({
      status: { type: 'string', enum: ['ok', 'skymd', 'forvrangd', 'saknas', 'kan_inte_bedomas'], description: 'ok = logotypen syns hel, oförvrängd och läsbar. skymd = delvis dold, beskuren eller för liten för att läsa. forvrangd = fel färg, fel form, utdragen eller förvanskad. saknas = ingen logotyp syns.' },
      sakerhet: confEnum, kommentar: comment,
    }),
    produktdetaljer: part({
      status: { type: 'string', enum: ['ok', 'otydlig', 'forvrangd', 'kan_inte_bedomas'], description: 'otydlig = suddig, mörk eller för liten för att se produkten ordentligt. forvrangd = produkter, händer, kanter eller föremål är deformerade, ofullständiga eller felaktiga, till exempel efter AI-redigering.' },
      sakerhet: confEnum, kommentar: comment,
    }),
    text_i_bild: part({
      finns_text: { type: 'boolean' },
      text: { type: 'string', description: 'All text i bilden, ordagrant, i läsordning. Tom sträng om ingen text finns.' },
      lasbarhet: { type: 'string', enum: ['god', 'svag', 'ingen_text'] },
      kommentar: comment,
    }),
    typsnitt: part({
      status: { type: 'string', enum: ['matchar', 'avviker', 'ingen_text', 'kan_inte_bedomas'] },
      observerat: { type: 'string', description: 'Kort beskrivning av typsnittet i bilden, t.ex. "geometrisk sans-serif, fet".' },
      sakerhet: confEnum, kommentar: comment,
    }),
    ai_artefakter: part({
      status: { type: 'string', enum: ['inga', 'misstanke', 'tydliga'], description: 'Spår av AI-redigering: utfyllda kanter, konstiga övergångar, förvrängd text, extra fingrar.' },
      sakerhet: confEnum, kommentar: comment,
    }),
  };
  if (withOriginal) {
    props.jamforelse = part({
      status: { type: 'string', enum: ['bevarad', 'avviker'], description: 'bevarad = logotyp, produkt och text är oförändrade jämfört med originalet.' },
      sakerhet: confEnum, kommentar: comment,
    });
  }
  return part(props);
}

const SYSTEM = [
  'Du granskar annonsmaterial för Meta-annonser åt Admiral, en svensk tjänst för små företag.',
  'Bedöm bara det du faktiskt ser i bilderna. Gissa inte. Är du osäker, säg det med låg säkerhet.',
  'Kommentarer skrivs på enkel svenska, en mening, utan facktermer från Meta.',
  'Skriv aldrig siffror om andelar, mått, priser eller resultat i kommentarerna.',
  'Svara bara med JSON enligt schemat.',
].join(' ');

function profileText(profile = {}) {
  const lines = [];
  if (profile.brand_name) lines.push(`Varumärke: ${profile.brand_name}`);
  if (profile.palette?.length) lines.push(`Varumärkets färger: ${profile.palette.map((p) => `${p.name || ''} ${p.hex}`.trim()).join(', ')}`);
  if (profile.fonts?.length) lines.push(`Varumärkets typsnitt: ${profile.fonts.join(', ')}`);
  if (profile.logo_notes) lines.push(`Om logotypen: ${profile.logo_notes}`);
  if (profile.product_notes) lines.push(`Om produkterna (får inte förvrängas): ${profile.product_notes}`);
  return lines.length ? lines.join('\n') : 'Ingen varumärkesprofil är ifylld. Bedöm logotyp och typsnitt utifrån hur de ser ut i bilden.';
}

const imageBlock = (img) => ({ type: 'image', source: { type: 'base64', media_type: img.contentType, data: img.buffer.toString('base64') } });

export function buildRequest({ image, logos = [], original = null, profile = {}, assetType = 'bild', model = DEFAULT_MODEL }) {
  const intro = assetType === 'video'
    ? 'Omslagsbilden (en bildruta) från annonsvideon som ska granskas. Rörelseoskärpa är normalt i en bildruta och är inget fel:'
    : 'Annonsbilden som ska granskas:';
  const content = [{ type: 'text', text: intro }, imageBlock(image)];
  logos.slice(0, 2).forEach((l, i) => content.push({ type: 'text', text: `Varumärkets logotyp${logos.length > 1 ? ` (${i + 1})` : ''}:` }, imageBlock(l)));
  if (original) content.push({ type: 'text', text: 'Originalet som annonsbilden är en variant av. Jämför logotyp, produkt och text:' }, imageBlock(original));
  content.push({ type: 'text', text: `${profileText(profile)}\n\nGranska annonsbilden.` });
  return {
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: responseSchema({ withOriginal: Boolean(original) }) } },
    messages: [{ role: 'user', content }],
  };
}

// Kommentarer med siffror om andelar, mått eller pengar ersätts: siffror kommer aldrig från modellen.
const NUMERIC = /\d[\d\s,.]*\s*(%|procent|kr|kronor|sek|px|pixlar|cm|mm)/i;
const clean = (s, fallback) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return !t || NUMERIC.test(t) ? fallback : t;
};

// Låg säkerhet på ett "ok" räcker inte: då ska en människa titta.
const withConfidence = (status, conf) => (status === 'ok' && conf === 'lag' ? 'varning' : status);

export function checksFromVision(out, { hasLogo = false, hasFonts = false, hasOriginal = false } = {}) {
  const v = out || {};
  const checks = [];
  const conf = (x) => CONF[x?.sakerhet] || null;

  // Utan logotyp i profilen vet vi inte säkert att det är varumärkets logotyp: högst en varning.
  const lg = v.logotyp || {};
  const lgStatus = { ok: 'ok', skymd: 'varning', forvrangd: hasLogo ? 'fel' : 'varning', saknas: hasLogo ? 'varning' : 'info', kan_inte_bedomas: 'manuell' }[lg.status] || 'manuell';
  checks.push({
    key: 'logotyp', label: 'Logotyp', by: 'ai', confidence: conf(lg),
    status: withConfidence(lgStatus, lg.sakerhet),
    summary: clean(lg.kommentar, { ok: 'Logotypen ser korrekt ut.', skymd: 'Logotypen syns bara delvis.', forvrangd: 'Logotypen ser förvrängd ut.', saknas: 'Ingen logotyp syns i bilden.' }[lg.status] || 'Logotypen gick inte att bedöma.'),
  });

  const pd = v.produktdetaljer || {};
  const pdStatus = { ok: 'ok', otydlig: 'varning', forvrangd: 'fel', kan_inte_bedomas: 'manuell' }[pd.status] || 'manuell';
  checks.push({
    key: 'produkt', label: 'Produktdetaljer', by: 'ai', confidence: conf(pd),
    status: withConfidence(pdStatus, pd.sakerhet),
    summary: clean(pd.kommentar, { ok: 'Produktdetaljerna ser korrekta ut.', otydlig: 'Produkten syns otydligt.', forvrangd: 'Produkt eller detaljer ser förvrängda ut.' }[pd.status] || 'Produktdetaljerna gick inte att bedöma.'),
  });

  const tb = v.text_i_bild || {};
  const ocr = tb.finns_text ? String(tb.text || '').slice(0, 2000) : '';
  checks.push({
    key: 'text_i_bild', label: 'Text i bilden', by: 'ai',
    status: tb.lasbarhet === 'svag' ? 'varning' : 'ok',
    summary: ocr ? clean(tb.kommentar, tb.lasbarhet === 'svag' ? 'Texten i bilden är svår att läsa.' : 'Texten i bilden är läsbar.') : 'Bilden har ingen text.',
    data: { text: ocr },
  });

  const ts = v.typsnitt || {};
  let tsStatus = { matchar: 'ok', avviker: 'varning', ingen_text: 'info', kan_inte_bedomas: 'manuell' }[ts.status] || 'manuell';
  if (!hasFonts && tsStatus !== 'info') tsStatus = 'info';
  checks.push({
    key: 'typsnitt', label: 'Typsnitt', by: 'ai', confidence: conf(ts),
    status: withConfidence(tsStatus, ts.sakerhet),
    summary: ts.status === 'ingen_text' ? 'Bilden har ingen text.'
      : hasFonts ? clean(ts.kommentar, ts.status === 'matchar' ? 'Typsnittet stämmer med varumärket.' : 'Typsnittet avviker från varumärket.')
        : `Varumärkesprofilen saknar typsnitt. I bilden: ${clean(ts.observerat, 'okänt typsnitt')}.`,
    data: { observed: clean(ts.observerat, '') },
  });

  const ai = v.ai_artefakter || {};
  checks.push({
    key: 'ai_artefakter', label: 'Spår av AI-redigering', by: 'ai', confidence: conf(ai),
    status: { inga: 'ok', misstanke: 'varning', tydliga: 'fel' }[ai.status] || 'manuell',
    summary: clean(ai.kommentar, ai.status === 'inga' ? 'Inga spår av AI-redigering.' : 'Bilden kan ha förvrängts av AI-redigering.'),
  });

  if (hasOriginal) {
    const jm = v.jamforelse || {};
    checks.push({
      key: 'jamforelse', label: 'Jämfört med originalet', by: 'ai', confidence: conf(jm),
      status: withConfidence({ bevarad: 'ok', avviker: 'fel' }[jm.status] || 'manuell', jm.sakerhet),
      summary: clean(jm.kommentar, jm.status === 'bevarad' ? 'Logotyp, produkt och text är bevarade.' : 'Varianten avviker från originalet.'),
    });
  }
  return { checks, ocrText: ocr };
}

export function manualChecks({ hasOriginal = false } = {}) {
  const m = (key, label) => ({ key, label, by: 'manuell', status: 'manuell', summary: 'Bedöms manuellt. Bildbedömning med AI är inte aktiv.' });
  return [
    m('logotyp', 'Logotyp'), m('produkt', 'Produktdetaljer'), m('text_i_bild', 'Text i bilden'),
    m('typsnitt', 'Typsnitt'), m('ai_artefakter', 'Spår av AI-redigering'),
    ...(hasOriginal ? [m('jamforelse', 'Jämfört med originalet')] : []),
  ];
}

export async function assessImage(args, { client } = {}) {
  const anthropic = client || new Anthropic();
  const req = buildRequest(args);
  const msg = await anthropic.messages.create(req);
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'refusal' || !text) throw new Error('Bildbedömningen gav inget svar');
  let output;
  try { output = JSON.parse(text); } catch { throw new Error('Bildbedömningen gav ett svar som inte gick att läsa'); }
  return { output, model: msg.model || req.model };
}
