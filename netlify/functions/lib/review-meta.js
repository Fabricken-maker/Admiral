/**
 * Admiral Modul B — hämtar aktiva annonser och deras bilder/videoomslag från Meta (endast läsning).
 *
 * En annons kan ha flera bilder eller videor (flexibelt format, asset_feed_spec). Varje bild och
 * varje videoomslag blir en egen granskning, med annonsens texter och Advantage+-inställningar.
 */
import crypto from 'node:crypto';
import { graphGet } from './meta-graph.js';
import { featuresFromSpec } from './review-rules.js';

const PAGE = 10; // Meta svarar "för mycket data" på större sidor för konton med flexibla annonser
const MAX_ADS = 60;
const STORY_FIELDS = 'link_data{message,name,description,image_hash,picture,call_to_action},video_data{message,title,link_description,video_id,image_url,call_to_action}';
const AD_FIELDS = [
  'id', 'name', 'effective_status', 'campaign{name}',
  `creative{id,object_type,image_url,image_hash,video_id,body,title,call_to_action_type,object_story_spec{${STORY_FIELDS}},asset_feed_spec{images,videos,bodies,titles,descriptions,call_to_action_types},degrees_of_freedom_spec}`,
].join(',');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const uniq = (arr) => [...new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))];

export function textsFromCreative(c = {}) {
  const afs = c.asset_feed_spec || {};
  const link = c.object_story_spec?.link_data || {};
  const video = c.object_story_spec?.video_data || {};
  return {
    bodies: uniq([...(afs.bodies || []).map((b) => b.text), link.message, video.message, c.body]),
    titles: uniq([...(afs.titles || []).map((t) => t.text), link.name, video.title, c.title]),
    descriptions: uniq([...(afs.descriptions || []).map((d) => d.text), link.description, video.link_description]),
    cta: uniq([...(afs.call_to_action_types || []), link.call_to_action?.type, video.call_to_action?.type, c.call_to_action_type]),
  };
}

// Bilder (hash) och videor (id) i annonsen, utan dubbletter.
export function mediaFromCreative(c = {}) {
  const afs = c.asset_feed_spec || {};
  const link = c.object_story_spec?.link_data || {};
  const video = c.object_story_spec?.video_data || {};
  const images = uniq([...(afs.images || []).map((i) => i.hash), link.image_hash, c.image_hash]);
  const videos = uniq([...(afs.videos || []).map((v) => v.video_id), video.video_id, c.video_id]);
  const fallbackUrl = (!images.length && !videos.length) ? (c.image_url || link.picture || video.image_url || null) : null;
  return { images, videos, fallbackUrl };
}

export const contentKey = ({ assetKey, texts, features }) => sha(JSON.stringify({ assetKey, texts, features: features || null }));

async function listActiveAds(accountId, token, get) {
  const ads = [];
  let after;
  do {
    const page = await get(`${accountId}/ads`, {
      fields: AD_FIELDS, limit: PAGE, after,
      filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }],
    }, token);
    ads.push(...(page.data || []));
    after = page.paging?.next ? page.paging.cursors?.after : null;
  } while (after && ads.length < MAX_ADS);
  return ads;
}

async function imageUrls(accountId, hashes, token, get) {
  if (!hashes.length) return {};
  const out = {};
  for (let i = 0; i < hashes.length; i += 25) {
    const res = await get(`${accountId}/adimages`, { hashes: hashes.slice(i, i + 25), fields: 'hash,url,width,height' }, token);
    for (const im of res.data || []) out[im.hash] = im.url;
  }
  return out;
}

async function videoCover(videoId, token, get) {
  const v = await get(videoId, { fields: 'picture,thumbnails{uri,width,height,is_preferred}' }, token);
  const thumbs = v.thumbnails?.data || [];
  const best = thumbs.find((t) => t.is_preferred) || thumbs.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return best?.uri || v.picture || null;
}

/**
 * Granskningsposter för alla aktiva annonser i kontot. Bilderna laddas inte ner här.
 * Returnerar [{ ad_id, ad_name, ad_status, campaign_name, asset_key, asset_type, source_url, texts, features, content_key }]
 */
export async function collectAssets(accountId, token, { get = graphGet } = {}) {
  const ads = await listActiveAds(accountId, token, get);
  const items = [];
  const hashes = uniq(ads.flatMap((a) => mediaFromCreative(a.creative).images));
  const urls = await imageUrls(accountId, hashes, token, get);

  for (const ad of ads) {
    const c = ad.creative || {};
    const texts = textsFromCreative(c);
    const features = c.degrees_of_freedom_spec ? featuresFromSpec(c.degrees_of_freedom_spec) : null;
    const base = { ad_account_id: accountId, ad_id: ad.id, ad_name: ad.name, ad_status: ad.effective_status, campaign_name: ad.campaign?.name || null, texts, features };
    const media = mediaFromCreative(c);
    for (const h of media.images) {
      if (!urls[h]) continue;
      const assetKey = `img:${h}`;
      items.push({ ...base, asset_key: assetKey, asset_type: 'bild', source_url: urls[h], content_key: contentKey({ assetKey, texts, features }) });
    }
    for (const vid of media.videos) {
      const url = await videoCover(vid, token, get).catch(() => null);
      if (!url) continue;
      const assetKey = `vid:${vid}`;
      items.push({ ...base, asset_key: assetKey, asset_type: 'video', source_url: url, content_key: contentKey({ assetKey, texts, features }) });
    }
    if (media.fallbackUrl) {
      const assetKey = `url:${sha(media.fallbackUrl.split('?')[0]).slice(0, 32)}`;
      items.push({ ...base, asset_key: assetKey, asset_type: 'bild', source_url: media.fallbackUrl, content_key: contentKey({ assetKey, texts, features }) });
    }
  }
  return items;
}
