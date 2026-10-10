/**
 * Admiral Modul B — varumärkesprofil per kund
 *
 * GET  /api/brand-profile?user_id=                                → profilen, logotyper och val för Advantage+
 * POST /api/brand-profile { user_id, profile }                     → spara (färger, typsnitt, ord, anteckningar …)
 * POST /api/brand-profile { action: 'logo', user_id, image_base64 } → lägg till logotyp (högst 3)
 * POST /api/brand-profile { action: 'remove_logo', user_id, path }  → ta bort logotyp
 *
 * Bara Fabricken (admin) i första versionen.
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { createReviewStore } from './lib/review-store.js';
import { normalizeProfile, ProfileInvalid, MAX_LOGOS } from './lib/brand-profile.js';
import { storeImage } from './lib/review-run.js';
import { FEATURE_LABELS } from './lib/review-rules.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, POST, OPTIONS');
  const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  let actor;
  try {
    const p = jwt.verify((event.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
    actor = { id: p.id, isAdmin: p.email === ADMIN_EMAIL };
  } catch {
    return json(401, { error: 'Unauthorized' });
  }
  if (!actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });

  const store = createReviewStore(supabase);
  try {
    if (event.httpMethod === 'GET') {
      const userId = Number(event.queryStringParameters?.user_id || actor.id);
      return json(200, await view(store, userId));
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');
    const userId = Number(body.user_id);
    if (!userId) return json(400, { error: 'Kund saknas' });
    const current = await store.getProfile(userId);

    if (body.action === 'logo') {
      if ((current.logo_paths || []).length >= MAX_LOGOS) return json(400, { error: `Högst ${MAX_LOGOS} logotyper.` });
      const buf = Buffer.from(String(body.image_base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
      if (!buf.length || buf.length > MAX_LOGO_BYTES) return json(400, { error: 'Logotypen saknas eller är större än 3 MB.' });
      let stored;
      try { stored = await storeImage(store, userId, buf, 'brand'); } catch (e) { return json(400, { error: e.message }); }
      const logo_paths = [...new Set([...(current.logo_paths || []), stored.path])];
      await store.saveProfile(userId, { ...(current.exists ? {} : await defaults(store, userId)), logo_paths }, actor.id);
      return json(200, await view(store, userId));
    }

    if (body.action === 'remove_logo') {
      const path = String(body.path || '');
      if (!(current.logo_paths || []).includes(path)) return json(404, { error: 'Logotypen finns inte' });
      await store.saveProfile(userId, { logo_paths: current.logo_paths.filter((p) => p !== path) }, actor.id);
      await store.remove([path]).catch(() => {});
      return json(200, await view(store, userId));
    }

    let patch;
    try { patch = normalizeProfile(body.profile || {}); } catch (e) {
      if (e instanceof ProfileInvalid) return json(400, { error: e.message, errors: e.errors });
      throw e;
    }
    await store.saveProfile(userId, { ...(current.exists ? {} : await defaults(store, userId)), ...patch }, actor.id);
    return json(200, await view(store, userId));
  } catch (e) {
    console.error('[brand-profile]', e.message);
    return json(500, { error: 'Något gick fel. Försök igen.' });
  }
};

// En ny profil får kundens annonskonton och standardspärrarna från början.
async function defaults(store, userId) {
  const base = await store.getProfile(userId);
  return { ad_account_ids: await store.accountsFor(userId, base), blocked_features: base.blocked_features };
}

async function view(store, userId) {
  const profile = await store.getProfile(userId);
  const urls = await store.signedUrls(profile.logo_paths || []);
  const accounts = await store.accountsFor(userId, profile);
  return {
    user_id: userId,
    exists: profile.exists,
    profile: {
      brand_name: profile.brand_name, ad_account_ids: profile.exists ? profile.ad_account_ids : accounts,
      palette: profile.palette, fonts: profile.fonts, logo_notes: profile.logo_notes, product_notes: profile.product_notes,
      tone_notes: profile.tone_notes, forbidden_words: profile.forbidden_words, required_phrases: profile.required_phrases,
      blocked_features: profile.blocked_features,
    },
    logos: (profile.logo_paths || []).map((p) => ({ path: p, url: urls[p] || null })),
    feature_labels: FEATURE_LABELS,
    updated_at: profile.updated_at || null,
  };
}

export default modern(handler);
