/**
 * Admiral Modul B — lagring: tabellerna brand_profiles och creative_reviews, och bilderna i den
 * privata lagringsytan "creatives". Bara service role når dem (RLS utan policyer).
 */
export const BUCKET = 'creatives';
export const SIGNED_URL_SECONDS = 3600;
export const STALE_MINUTES = 20;
export const MAX_ATTEMPTS = 3;
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

export const DEFAULT_PROFILE = {
  brand_name: null, ad_account_ids: [], palette: [], fonts: [], logo_paths: [], logo_notes: null,
  product_notes: null, tone_notes: null, forbidden_words: [], required_phrases: [],
  blocked_features: ['image_uncrop', 'video_uncrop', 'image_background_gen', 'image_templates', 'add_text_overlay', 'image_animation', 'text_generation', 'multi_photo_to_video', 'cv_transformation'],
};

export function createReviewStore(supabase) {
  const storage = () => supabase.storage.from(BUCKET);
  const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

  return {
    async getProfile(userId) {
      const data = must(await supabase.from('brand_profiles').select('*').eq('user_id', userId).maybeSingle(), 'brand_profiles');
      return data ? { ...DEFAULT_PROFILE, ...data, exists: true } : { ...DEFAULT_PROFILE, user_id: userId, exists: false };
    },

    async saveProfile(userId, patch, actorId) {
      const row = { user_id: userId, ...patch, updated_by: actorId, updated_at: new Date().toISOString() };
      return must(await supabase.from('brand_profiles').upsert(row, { onConflict: 'user_id' }).select('*').single(), 'brand_profiles');
    },

    // Konton att granska: profilens, annars veckovyns, annars skrivinställningarnas, annars kundens
    // kopplade konton (admin har kundkonton som standardkonto i users, därför kommer det sist).
    async accountsFor(userId, profile) {
      if (profile?.ad_account_ids?.length) return profile.ad_account_ids;
      for (const table of ['weekly_settings', 'write_settings']) {
        const { data } = await supabase.from(table).select('ad_account_ids').eq('user_id', userId).maybeSingle();
        if (data?.ad_account_ids?.length) return data.ad_account_ids;
      }
      const { data: u } = await supabase.from('users').select('meta_ad_account_id, meta_ad_account_id_2, meta_ad_account_id_3').eq('id', userId).maybeSingle();
      return [u?.meta_ad_account_id, u?.meta_ad_account_id_2, u?.meta_ad_account_id_3]
        .filter(Boolean).map((a) => (String(a).startsWith('act_') ? a : `act_${a}`));
    },

    async customers() {
      const { data: users } = await supabase.from('users').select('id, email, company_name, meta_ad_account_id, status').eq('status', 'active').order('id');
      const { data: profiles } = await supabase.from('brand_profiles').select('user_id');
      const { data: weekly } = await supabase.from('weekly_settings').select('user_id');
      const ids = new Set([...(profiles || []), ...(weekly || [])].map((r) => r.user_id));
      return (users || [])
        .filter((u) => ids.has(u.id) || u.meta_ad_account_id)
        .map((u) => ({ user_id: u.id, name: u.company_name ? `${u.company_name} · ${u.email}` : u.email, is_admin: u.email === ADMIN_EMAIL }));
    },

    // Köar nya granskningar. Samma innehåll (content_key) köas aldrig igen.
    async enqueue(rows) {
      const created = [];
      for (const r of rows) {
        const { data, error } = await supabase.from('creative_reviews').insert(r).select('id').single();
        if (error) {
          if (error.code === '23505') continue;
          throw new Error(`creative_reviews: ${error.message}`);
        }
        created.push(data.id);
      }
      return created;
    },

    // Granskningar som fastnat (t.ex. avbruten körning) köas om, högst MAX_ATTEMPTS gånger.
    async releaseStale() {
      const cutoff = new Date(Date.now() - STALE_MINUTES * 60000).toISOString();
      const stale = must(await supabase.from('creative_reviews').select('id, attempts').eq('status', 'analyserar').lt('updated_at', cutoff), 'creative_reviews');
      for (const s of stale) {
        const failed = s.attempts >= MAX_ATTEMPTS;
        await supabase.from('creative_reviews').update({
          status: failed ? 'fel' : 'koar',
          error: failed ? 'Granskningen avbröts flera gånger.' : null,
          updated_at: new Date().toISOString(),
        }).eq('id', s.id).eq('status', 'analyserar');
      }
      return stale.length;
    },

    // Tar en köad granskning. Villkoret status = koar gör att bara en körning får den.
    async claimNext() {
      const queued = must(await supabase.from('creative_reviews').select('id, attempts').eq('status', 'koar').order('created_at').limit(5), 'creative_reviews');
      for (const q of queued) {
        const { data } = await supabase.from('creative_reviews')
          .update({ status: 'analyserar', attempts: q.attempts + 1, updated_at: new Date().toISOString() })
          .eq('id', q.id).eq('status', 'koar').select('*');
        if (data?.length) return data[0];
      }
      return null;
    },

    async getReview(id) {
      return must(await supabase.from('creative_reviews').select('*').eq('id', id).maybeSingle(), 'creative_reviews');
    },

    async updateReview(id, patch) {
      must(await supabase.from('creative_reviews').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'creative_reviews');
    },

    async listReviews(userId, limit = 200) {
      return must(await supabase.from('creative_reviews')
        .select('id, user_id, ad_id, ad_name, ad_status, campaign_name, asset_key, asset_type, source, verdict, verdict_reason, status, decided_verdict, image_path, original_review_id, created_at, analyzed_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit), 'creative_reviews');
    },

    async upload(path, buffer, contentType) {
      must(await storage().upload(path, buffer, { contentType, upsert: true }), 'lagring');
      return path;
    },

    async download(path) {
      const blob = must(await storage().download(path), 'lagring');
      return Buffer.from(await blob.arrayBuffer());
    },

    async signedUrls(paths) {
      const list = [...new Set(paths.filter(Boolean))];
      if (!list.length) return {};
      const data = must(await storage().createSignedUrls(list, SIGNED_URL_SECONDS), 'lagring');
      return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
    },

    async remove(paths) {
      if (paths.length) must(await storage().remove(paths), 'lagring');
    },
  };
}

// Senaste granskningen per annons och bild/video (äldre versioner är historik).
export function latestPerAsset(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = `${r.ad_id || r.id}|${r.asset_key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const effectiveVerdict = (r) => r.decided_verdict || r.verdict || null;
