/**
 * Admiral Modul B — genomför en granskning: hämtar bilden, kör reglerna och bildbedömningen,
 * sätter domslut och sparar. Anropas av reviews-run-background.
 */
import crypto from 'node:crypto';
import { decodeImage, imageType, CONTENT_TYPES, EXTENSIONS } from './image-decode.js';
import { checkFormat, checkColors, scanTexts, checkFeatures, verdictFor } from './review-rules.js';
import { visionAvailable, assessImage, checksFromVision, manualChecks, DEFAULT_MODEL } from './review-vision.js';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
// Claude tar emot bilder upp till 5 MB (base64). Större bilder bedöms manuellt.
const VISION_MAX_BYTES = 3.7 * 1024 * 1024;

export async function fetchImage(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Bilden kunde inte hämtas från Meta (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('Bilden är för stor för att granskas');
  return buf;
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export async function storeImage(store, userId, buf, folder = 'reviews') {
  const type = imageType(buf);
  if (!type) throw new Error('Filen är inte en bild (JPEG, PNG, WebP eller GIF)');
  const hash = sha256(buf);
  const path = `${folder}/${userId}/${hash}.${EXTENSIONS[type]}`;
  await store.upload(path, buf, CONTENT_TYPES[type]);
  return { path, hash, type };
}

const asVisionImage = (buf) => {
  const type = imageType(buf);
  return type && buf.length <= VISION_MAX_BYTES ? { buffer: buf, contentType: CONTENT_TYPES[type] } : null;
};

/**
 * @param review  rad ur creative_reviews (status analyserar)
 * @param deps    { store, fetchImpl, vision: { available, assess }, model }
 * @returns patch för raden
 */
export async function runReview(review, { store, fetchImpl = fetch, vision = {}, model } = {}) {
  const profile = await store.getProfile(review.user_id);

  // 1. Bilden: redan sparad (uppladdad) eller hämtas från Meta och sparas
  let buf;
  let imagePath = review.image_path;
  if (imagePath) buf = await store.download(imagePath);
  else {
    if (!review.source_url) throw new Error('Granskningen saknar bild');
    buf = await fetchImage(review.source_url, fetchImpl);
    imagePath = (await storeImage(store, review.user_id, buf)).path;
  }
  const image = decodeImage(buf);

  // 2. Regler
  const format = checkFormat({ width: image.width, height: image.height, assetType: review.asset_type });
  const colors = checkColors(image, profile.palette);
  const features = checkFeatures(review.features, profile.blocked_features || []);

  // 3. Bildbedömning (AI) eller manuell
  const original = review.original_review_id ? await store.getReview(review.original_review_id) : null;
  const hasOriginal = Boolean(original?.image_path);
  const useVision = (vision.available ?? visionAvailable()) && asVisionImage(buf);
  let visionChecks;
  let ocrText = '';
  let aiModel = null;
  if (useVision) {
    const logos = [];
    for (const p of (profile.logo_paths || []).slice(0, 2)) {
      const l = asVisionImage(await store.download(p).catch(() => Buffer.alloc(0)));
      if (l) logos.push(l);
    }
    const orig = hasOriginal ? asVisionImage(await store.download(original.image_path)) : null;
    const assess = vision.assess || assessImage;
    try {
      const { output, model: used } = await assess({ image: asVisionImage(buf), logos, original: orig, profile, assetType: review.asset_type, model: model || process.env.ADMIRAL_VISION_MODEL || DEFAULT_MODEL });
      ({ checks: visionChecks, ocrText } = checksFromVision(output, { hasLogo: logos.length > 0, hasFonts: (profile.fonts || []).length > 0, hasOriginal: Boolean(orig) }));
      aiModel = used;
    } catch (e) {
      // Bildbedömningen misslyckades: granskningen blir klar ändå, med de kontrollerna som manuella.
      visionChecks = manualChecks({ hasOriginal }).map((c) => ({ ...c, summary: 'Bildbedömningen med AI misslyckades. Bedöms manuellt.', data: { error: redact(e.message) } }));
    }
  } else {
    visionChecks = manualChecks({ hasOriginal });
  }

  // 4. Texterna, inklusive texten som lästes ur bilden
  const texts = scanTexts({ texts: review.texts, ocrText, profile });

  const checks = [...visionChecks.filter((c) => c.key !== 'text_i_bild'), visionChecks.find((c) => c.key === 'text_i_bild'), texts, format, colors, features].filter(Boolean);
  const { verdict, reason } = verdictFor(checks);
  return {
    status: 'klar',
    error: null,
    checks,
    verdict,
    verdict_reason: reason,
    image_path: imagePath,
    image_sha256: sha256(buf),
    width: image.width,
    height: image.height,
    ai_model: aiModel,
    source_url: null, // Metas bildadresser går ut och sparas inte
    analyzed_at: new Date().toISOString(),
  };
}

// Felmeddelanden sparas utan token eller signerade adresser.
export const redact = (msg) => String(msg || '')
  .replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]')
  .replace(/https?:\/\/\S+/g, '[adress]')
  .slice(0, 300);
