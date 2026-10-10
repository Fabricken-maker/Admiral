// Agent 4, del 5 — Kreativ trötthet (Modul E).
//
// Larmar för:
//  - åtgärder för byte av annons vars variant inte är Godkänd i granskningen (får aldrig nå kunden)
//  - byten där den nya annonsen inte skapades pausad före aktiveringen
//  - trötta annonser som efter två dygn fortfarande saknar varianter
//  - att den dagliga kontrollen (fatigue-sync) har rapporterat fel
// Inga reparationer: hälsokollen ändrar aldrig åtgärder, annonser eller domslut.
import { pass, fail } from '../lib/result.js';

const A = 'jobs';
const WINDOW_DAYS = 8;
const VARIANT_HOURS = 48;
const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

export const approvedVariant = (r) => Boolean(r && r.fatigue_id && r.status === 'klar' && (r.decided_verdict || r.verdict) === 'godkand');

// Åtgärder (pending/approved/verifying/done) vars variant inte är godkänd.
export function proposalsWithoutApprovedVariant(proposals, reviews) {
  const byId = new Map(reviews.map((r) => [String(r.id), r]));
  return proposals.filter((p) => p.kind === 'change' && !approvedVariant(byId.get(String(p.meta?.variant_review_id))));
}

// Genomförda byten där loggen inte visar att den nya annonsen skapades pausad.
export function swapsNotCreatedPaused(logs) {
  return logs.filter((l) => l.action === 'apply' && l.status !== 'failed' && l.request?.created?.status !== 'PAUSED');
}

export async function checkFatigue(ctx) {
  const { supabase } = ctx;
  let open;
  try {
    open = await supabase.select('ad_fatigue', 'select=id,ad_name,status,variants_generated_at,detected_at&status=eq.trott');
  } catch (e) {
    return [fail(A, 'jobs.kreativ trötthet', `Kunde inte läsa ad_fatigue: ${e.message}`, { where: 'Supabase ad_fatigue' })];
  }
  const proposals = await supabase.select('proposals', 'select=id,kind,status,meta,object_name&type=eq.creative_swap&status=in.(pending,approved,verifying,done)');
  ctx.metrics.fatigue = { open: open.length, swap_proposals: proposals.length };
  const out = [];

  const ids = [...new Set(proposals.map((p) => p.meta?.variant_review_id).filter(Boolean))];
  const reviews = ids.length ? await supabase.select('creative_reviews', `select=id,fatigue_id,status,verdict,decided_verdict&id=in.(${ids.join(',')})`) : [];
  const bad = proposalsWithoutApprovedVariant(proposals, reviews);
  out.push(bad.length
    ? fail(A, 'jobs.byte med ogodkänd variant', `${bad.length} åtgärd(er) för byte av annons bygger på en variant som inte är Godkänd: ${bad.slice(0, 3).map((p) => `åtgärd ${p.id} "${p.object_name}"`).join(', ')}`, { where: 'proposals (type creative_swap) / creative_reviews' })
    : pass(A, 'jobs.byte med ogodkänd variant', { checked: proposals.length }));

  const swapIds = proposals.filter((p) => p.kind === 'change' && ['verifying', 'done'].includes(p.status)).map((p) => p.id);
  const logs = swapIds.length ? await supabase.select('meta_write_log', `select=id,proposal_id,action,status,request&proposal_id=in.(${swapIds.join(',')})`) : [];
  const notPaused = swapsNotCreatedPaused(logs);
  out.push(notPaused.length
    ? fail(A, 'jobs.ny annons skapad pausad', `${notPaused.length} byte(n) saknar bekräftelse på att den nya annonsen skapades pausad: ${notPaused.slice(0, 3).map((l) => `logg ${l.id}`).join(', ')}`, { where: 'netlify/functions/lib/meta-write.js (swapCreative) / meta_write_log.request.created' })
    : pass(A, 'jobs.ny annons skapad pausad', { checked: logs.length }));

  const stuck = open.filter((f) => !f.variants_generated_at && f.detected_at < ago(VARIANT_HOURS));
  out.push(stuck.length
    ? fail(A, 'jobs.varianter för trötta annonser', `${stuck.length} trött(a) annons(er) saknar varianter efter två dygn: ${stuck.slice(0, 3).map((f) => `"${f.ad_name}"`).join(', ')}`, { where: 'netlify/functions/reviews-run-background.js → lib/fatigue-flow.js (ensureVariants)' })
    : pass(A, 'jobs.varianter för trötta annonser'));

  const reports = await supabase.select('health_reports', `select=report_date,message&category=eq.fatigue_sync&created_at=gte.${ago(WINDOW_DAYS * 24)}`);
  out.push(reports.length
    ? fail(A, 'jobs.fatigue-sync', `Den dagliga kontrollen av kreativ trötthet rapporterade fel: ${reports.slice(0, 3).map((r) => `${r.report_date} ${r.message}`).join('; ')}`, { where: 'netlify/functions/fatigue-sync.js (schema 45 5 * * *)' })
    : pass(A, 'jobs.fatigue-sync'));
  return out;
}
