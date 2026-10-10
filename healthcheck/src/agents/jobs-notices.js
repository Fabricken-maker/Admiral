// Agent 4, del 3 — Mejlen om Meta-kopplingen (nightly-health-check).
//
// Varje koppling ska få ett mejl per läge: 7 dagar kvar, 3 dagar kvar, utgånget. Raden i
// notice_log skrivs när mejlet har gått iväg. Larmar om kopplingen har varit i sitt nuvarande
// läge i mer än ett dygn (nattjobbet har hunnit köra) utan att mejlet finns i loggen.
// Samma lägen som netlify/functions/lib/token-notice.js. Ingen reparation: mejl skickas aldrig av hälsokollen.
import { pass, fail } from '../lib/result.js';

const A = 'jobs';
const DAY = 86400000;
const GRACE_MS = 26 * 3600000; // nattjobbet kör 07:00 UTC varje dag
const STALE_EXPIRED_DAYS = 14;

const toDate = (v) => {
  const s = String(v);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
};

// Nuvarande läge och när det började, eller null om inget mejl ska ha skickats.
export function currentNotice(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const exp = toDate(expiresAt);
  const msLeft = exp.getTime() - now.getTime();
  if (Number.isNaN(msLeft)) return null;
  if (msLeft <= 0) return -msLeft <= STALE_EXPIRED_DAYS * DAY ? { state: 'utgatt', since: exp } : null;
  const days = Math.ceil(msLeft / DAY);
  if (days <= 3) return { state: 'tre_dagar', since: new Date(exp.getTime() - 3 * DAY) };
  if (days <= 7) return { state: 'sju_dagar', since: new Date(exp.getTime() - 7 * DAY) };
  return null;
}

export function missingNotices(tokens, log, now = new Date()) {
  const sent = new Set(log.map((r) => `${r.user_id}|${r.ref}|${r.state}`));
  return tokens.flatMap((t) => {
    const n = currentNotice(t.expires_at, now);
    if (!n || now - n.since < GRACE_MS) return [];
    const ref = toDate(t.expires_at).toISOString();
    return sent.has(`${t.user_id}|${ref}|${n.state}`) ? [] : [{ ...t, state: n.state }];
  });
}

const LABEL = { sju_dagar: '7 dagar kvar', tre_dagar: '3 dagar kvar', utgatt: 'utgånget' };

export async function checkTokenNotices(ctx) {
  const id = 'jobs.mejl om Meta-kopplingen';
  const where = 'netlify/functions/nightly-health-check.js → lib/token-notice.js (notice_log)';
  const recheck = async () => {
    const tokens = await ctx.supabase.select('meta_tokens', 'select=user_id,expires_at,users!inner(email,company_name,status)&users.status=eq.active');
    const log = await ctx.supabase.select('notice_log', 'select=user_id,ref,state&kind=eq.meta_token');
    const missing = missingNotices(tokens, log);
    return missing.length
      ? { ok: false, cause: `Mejlet om Meta-kopplingen har inte skickats: ${missing.slice(0, 3).map((m) => `${m.users.company_name || m.users.email} (${LABEL[m.state]})`).join(', ')}` }
      : { ok: true, checked: tokens.length };
  };
  try {
    const r = await recheck();
    return r.ok ? pass(A, id, { checked: r.checked }) : fail(A, id, r.cause, { where, recheck });
  } catch (e) {
    return fail(A, id, `Kunde inte läsa notice_log: ${e.message}`, { where });
  }
}
