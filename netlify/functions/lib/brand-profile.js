/**
 * Admiral Modul B — validering av varumärkesprofilen innan den sparas.
 */
export class ProfileInvalid extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'ProfileInvalid';
    this.errors = errors;
  }
}

const LIMITS = { colors: 12, fonts: 8, words: 50, logos: 3, note: 1000, short: 80 };
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, maxItems, maxLen) => {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/);
  return [...new Set(arr.map((s) => str(s, maxLen)).filter(Boolean))].slice(0, maxItems);
};

// Tar bara emot fälten som får ändras. Logotyper hanteras separat (uppladdning).
export function normalizeProfile(input = {}) {
  const errors = [];
  const out = {};
  if ('brand_name' in input) out.brand_name = str(input.brand_name, LIMITS.short) || null;
  if ('ad_account_ids' in input) {
    out.ad_account_ids = list(input.ad_account_ids, 10, 40).map((a) => (/^\d+$/.test(a) ? `act_${a}` : a));
    const bad = out.ad_account_ids.filter((a) => !/^act_\d+$/.test(a));
    if (bad.length) errors.push(`Ogiltigt annonskonto: ${bad.join(', ')}.`);
  }
  if ('palette' in input) {
    const raw = Array.isArray(input.palette) ? input.palette : [];
    out.palette = raw.slice(0, LIMITS.colors).map((p) => ({ hex: str(p?.hex, 7).toLowerCase(), name: str(p?.name, 40) || null }));
    const bad = out.palette.filter((p) => !/^#[0-9a-f]{6}$/.test(p.hex));
    if (bad.length) errors.push('Färger anges som hex, till exempel #00d9ff.');
    if (raw.length > LIMITS.colors) errors.push(`Högst ${LIMITS.colors} färger.`);
  }
  if ('fonts' in input) out.fonts = list(input.fonts, LIMITS.fonts, 60);
  for (const k of ['logo_notes', 'product_notes', 'tone_notes']) if (k in input) out[k] = str(input[k], LIMITS.note) || null;
  for (const k of ['forbidden_words', 'required_phrases']) if (k in input) out[k] = list(input[k], LIMITS.words, 80);
  if ('blocked_features' in input) {
    out.blocked_features = list(input.blocked_features, 60, 60);
    if (out.blocked_features.some((f) => !/^[a-z0-9_]+$/.test(f))) errors.push('Ogiltigt namn på förbättring.');
  }
  if (errors.length) throw new ProfileInvalid(errors);
  return out;
}

export const MAX_LOGOS = LIMITS.logos;
