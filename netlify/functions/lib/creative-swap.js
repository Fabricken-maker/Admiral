/**
 * Admiral Modul E — bygger den nya annonsen (byte av trött annons mot en godkänd variant).
 *
 * Den nya annonsen får samma sida, Instagram-konto, länk och knapp som den gamla, och
 * variantens media och texter. Den skapas alltid som en enkel annons (en bild eller en video)
 * i samma annonsuppsättning. Advantage+-förbättringar som varumärkesprofilen spärrar stängs av.
 *
 * Värdemodell för förslagstypen creative_swap: { ads: { "<annons-id>": "ACTIVE" | "PAUSED" } }
 *   current_value:  { ads: { gammal: "ACTIVE" }, creative_ids: { gammal: "<creative-id>" } }
 *   proposed_value: { ads: { gammal: "PAUSED", new: "ACTIVE" } }   ("new" byts mot den nya annonsens id)
 */
export const NEW_AD = 'new';
// Paket som Meta inte tar emot på nya annonser. Enskilda förbättringar kopieras i stället.
const BUNDLES = ['standard_enhancements', 'advantage_plus_creative'];

const first = (arr) => (arr || []).find((x) => x && String(x).trim()) || '';

export function linkAndCta(creative = {}) {
  const oss = creative.object_story_spec || {};
  const afs = creative.asset_feed_spec || {};
  const link = oss.link_data?.link || oss.link_data?.call_to_action?.value?.link || oss.video_data?.call_to_action?.value?.link
    || afs.link_urls?.[0]?.website_url || null;
  const cta = oss.link_data?.call_to_action?.type || oss.video_data?.call_to_action?.type || afs.call_to_action_types?.[0]
    || creative.call_to_action_type || 'LEARN_MORE';
  return { link, cta };
}

// Media för varianten: samma video eller bild som originalet, eller en ny bild som laddas upp.
export function variantMedia(variant) {
  const key = String(variant.asset_key || '');
  if (key.startsWith('vid:')) return { kind: 'video', video_id: key.slice(4) };
  if (key.startsWith('img:')) return { kind: 'image', image_hash: key.slice(4) };
  if (variant.image_path) return { kind: 'upload', image_path: variant.image_path };
  throw new Error('Varianten saknar bild eller video');
}

export function featuresSpec(creative = {}, blocked = []) {
  const spec = creative.degrees_of_freedom_spec?.creative_features_spec || {};
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (BUNDLES.includes(k) || !v?.enroll_status) continue;
    out[k] = { enroll_status: blocked.includes(k) ? 'OPT_OUT' : v.enroll_status };
  }
  return Object.keys(out).length ? { creative_features_spec: out } : null;
}

/**
 * Det som sparas i förslaget (meta.swap) när förslaget skapas.
 * old: { ad_id, name, adset_id, creative } (creative hämtad från Meta), variant: creative_reviews-rad.
 */
export function buildSwapSpec({ old, variant, original, profile = {} }) {
  const oss = old.creative?.object_story_spec || {};
  if (!oss.page_id) throw new Error('Den gamla annonsen saknar Facebook-sida');
  const { link, cta } = linkAndCta(old.creative);
  if (!link) throw new Error('Den gamla annonsen saknar länk');
  const t = variant.texts || {};
  const o = original?.texts || {};
  return {
    page_id: oss.page_id,
    instagram_user_id: oss.instagram_user_id || null,
    link,
    cta,
    media: variantMedia(variant),
    // Samma video som den gamla annonsen: återanvänd dess omslagsbild (sparad hos Meta).
    thumbnail_hash: oss.video_data?.image_hash && oss.video_data.video_id === variantMedia(variant).video_id ? oss.video_data.image_hash : null,
    message: first(t.bodies) || first(o.bodies),
    title: first(t.titles) || first(o.titles),
    description: first(t.descriptions) || first(o.descriptions),
    features: featuresSpec(old.creative, profile.blocked_features || []),
    adset_id: old.adset_id,
    ad_name: `${old.name} – variant ${variant.variant_label || 'B'} (Admiral)`.slice(0, 190),
  };
}

// Parametrar till POST /act_x/adcreatives. imageHash/thumbnailUrl hämtas precis före skrivningen.
export function creativeParams(spec, { imageHash = null, thumbnailUrl = null, withFeatures = true } = {}) {
  const cta = { type: spec.cta, value: { link: spec.link } };
  const story = { page_id: spec.page_id, ...(spec.instagram_user_id ? { instagram_user_id: spec.instagram_user_id } : {}) };
  if (spec.media.kind === 'video') {
    story.video_data = {
      video_id: spec.media.video_id, message: spec.message, title: spec.title,
      ...(spec.description ? { link_description: spec.description } : {}),
      ...(spec.thumbnail_hash ? { image_hash: spec.thumbnail_hash } : thumbnailUrl ? { image_url: thumbnailUrl } : {}),
      call_to_action: cta,
    };
  } else {
    story.link_data = {
      link: spec.link, message: spec.message, name: spec.title,
      ...(spec.description ? { description: spec.description } : {}),
      image_hash: imageHash || spec.media.image_hash, call_to_action: cta,
    };
  }
  return {
    name: spec.ad_name,
    object_story_spec: story,
    ...(withFeatures && spec.features ? { degrees_of_freedom_spec: spec.features } : {}),
  };
}

export function swapValues(oldAdId, oldStatus, oldCreativeId) {
  return {
    current: { ads: { [oldAdId]: oldStatus }, creative_ids: { [oldAdId]: oldCreativeId } },
    proposed: { ads: { [oldAdId]: 'PAUSED', [NEW_AD]: 'ACTIVE' } },
  };
}

// Byter platshållaren "new" mot den nya annonsens id.
export function withNewAdId(value, newAdId) {
  const ads = { ...value.ads };
  if (NEW_AD in ads) { ads[newAdId] = ads[NEW_AD]; delete ads[NEW_AD]; }
  return { ...value, ads };
}
