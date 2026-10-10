// Agent 4, del 4 — Granskning av annonsmaterial (Modul B).
//
// Larmar för:
//  - granskningar som fastnat i kön (köad i mer än 2 timmar, pågående i mer än 30 minuter)
//  - granskningar som misslyckats den senaste veckan
//  - att bildbedömningen med AI inte används (alla veckans granskningar saknar AI-modell)
//  - att den dagliga granskningen (reviews-sync) har rapporterat fel
// Inga reparationer: hälsokollen granskar aldrig själv och ändrar inga domslut.
import { pass, fail } from '../lib/result.js';

const A = 'jobs';
const QUEUED_MINUTES = 120;
const RUNNING_MINUTES = 30;
const WINDOW_DAYS = 8;
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

export function stuckReviews(rows, now = Date.now()) {
  return rows.filter((r) => {
    const age = (now - new Date(r.updated_at).getTime()) / 60000;
    return (r.status === 'koar' && age > QUEUED_MINUTES) || (r.status === 'analyserar' && age > RUNNING_MINUTES);
  });
}

export function aiUnused(rows) {
  const done = rows.filter((r) => r.status === 'klar');
  return done.length > 0 && done.every((r) => !r.ai_model);
}

export async function checkReviews(ctx) {
  const { supabase } = ctx;
  let profiles;
  try {
    profiles = await supabase.select('brand_profiles', 'select=user_id');
  } catch (e) {
    return [fail(A, 'jobs.granskning', `Kunde inte läsa brand_profiles: ${e.message}`, { where: 'Supabase brand_profiles' })];
  }
  const since = ago(WINDOW_DAYS * 24 * 60);
  const rows = await supabase.select('creative_reviews', `select=id,user_id,ad_name,status,error,ai_model,updated_at&updated_at=gte.${since}`);
  ctx.metrics.reviews = { profiles: profiles.length, reviewed: rows.length, failed: rows.filter((r) => r.status === 'fel').length };
  if (!profiles.length && !rows.length) return [];

  const out = [];
  const stuckId = 'jobs.granskningar som fastnat';
  const recheckStuck = async () => {
    const live = await supabase.select('creative_reviews', 'select=id,ad_name,status,updated_at&status=in.(koar,analyserar)');
    const stuck = stuckReviews(live);
    return stuck.length
      ? { ok: false, cause: `${stuck.length} granskning(ar) har fastnat: ${stuck.slice(0, 3).map((r) => `${r.id} "${r.ad_name || 'uppladdad bild'}" (${r.status === 'koar' ? 'köad' : 'pågår'})`).join(', ')}` }
      : { ok: true };
  };
  const s = await recheckStuck();
  out.push(s.ok ? pass(A, stuckId) : fail(A, stuckId, s.cause, { where: 'netlify/functions/reviews-run-background.js (creative_reviews.status)', recheck: recheckStuck }));

  const failed = rows.filter((r) => r.status === 'fel');
  out.push(failed.length
    ? fail(A, 'jobs.misslyckade granskningar', `${failed.length} granskning(ar) misslyckades senaste veckan: ${failed.slice(0, 3).map((r) => `${r.id} (${r.error || 'okänt fel'})`).join(', ')}`, { where: 'creative_reviews.error' })
    : pass(A, 'jobs.misslyckade granskningar', { checked: rows.length }));

  out.push(aiUnused(rows)
    ? fail(A, 'jobs.bildbedömning med AI', 'Ingen av veckans granskningar gjordes med AI. Logotyp, produktdetaljer, text i bilden och typsnitt bedöms då bara manuellt.', { where: 'Netlify AI Gateway (ANTHROPIC_API_KEY i funktionerna) / lib/review-vision.js' })
    : pass(A, 'jobs.bildbedömning med AI'));

  const reports = await supabase.select('health_reports', `select=report_date,message&category=eq.reviews_sync&created_at=gte.${since}`);
  out.push(reports.length
    ? fail(A, 'jobs.reviews-sync', `Den dagliga granskningen rapporterade fel: ${reports.slice(0, 3).map((r) => `${r.report_date} ${r.message}`).join('; ')}`, { where: 'netlify/functions/reviews-sync.js (schema 30 5 * * *)' })
    : pass(A, 'jobs.reviews-sync'));
  return out;
}
