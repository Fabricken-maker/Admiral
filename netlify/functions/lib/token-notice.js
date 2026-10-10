/**
 * Mejl om Meta-kopplingen: ett mejl per läge och koppling, aldrig ett om dagen.
 *
 * Lägen: sju_dagar (≤ 7 dagar kvar), tre_dagar (≤ 3 dagar kvar), utgatt (har gått ut).
 * Ett läge räknas per koppling, alltså per utgångstid. Kopplar kunden om Meta får den nya
 * kopplingen en ny utgångstid och lägena börjar om.
 * En koppling som gick ut för länge sedan (före den här funktionen) ger inget mejl.
 */
export const NOTICE_KIND = 'meta_token';
export const STALE_EXPIRED_DAYS = 14;
const DAY = 86400000;

// meta_tokens.expires_at är "timestamp without time zone" och sparas i UTC. Utan tidszon i
// strängen skulle Node tolka den som lokal tid, så den läses uttryckligen som UTC.
export function toDate(value) {
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

export function daysLeft(expiresAt, now = new Date()) {
  return Math.ceil((toDate(expiresAt).getTime() - now.getTime()) / DAY);
}

export function noticeState(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const msLeft = toDate(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(msLeft)) return null;
  if (msLeft <= 0) return -msLeft <= STALE_EXPIRED_DAYS * DAY ? 'utgatt' : null;
  const days = Math.ceil(msLeft / DAY);
  if (days <= 3) return 'tre_dagar';
  if (days <= 7) return 'sju_dagar';
  return null;
}

// Utgångstiden i en stabil form, så att samma koppling alltid ger samma nyckel.
export const noticeRef = (expiresAt) => toDate(expiresAt).toISOString();

export function swedishDate(date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'long' }).format(toDate(date));
}

// Text till hälsorapporten (health_reports), samma lägen som mejlet.
export function healthFinding(expiresAt, now = new Date()) {
  const days = daysLeft(expiresAt, now);
  const date = swedishDate(expiresAt);
  if (days <= 0) return { severity: 'critical', message: `Meta-kopplingen gick ut ${date}. Koppla om Meta i Admiral.`, details: { days_left: days } };
  if (days <= 3) return { severity: 'critical', message: `Meta-kopplingen går ut ${date}. Koppla om Meta i Admiral.`, details: { days_left: days } };
  if (days <= 7) return { severity: 'warning', message: `Meta-kopplingen går ut ${date}.`, details: { days_left: days } };
  return { severity: 'info', message: `Meta-kopplingen gäller till ${date}.`, details: { days_left: days } };
}

export function buildNotice({ state, expiresAt }) {
  const date = swedishDate(expiresAt);
  const copy = {
    sju_dagar: {
      subject: `Meta-kopplingen i Admiral går ut ${date}`,
      heading: 'Meta-kopplingen behöver förnyas',
      text: `Admirals koppling till ditt Meta-konto går ut ${date}. Koppla om Meta i Admiral före dess så att uppföljningen av dina annonser fortsätter utan avbrott.`,
    },
    tre_dagar: {
      subject: `Meta-kopplingen i Admiral går ut ${date}`,
      heading: 'Meta-kopplingen går ut snart',
      text: `Admirals koppling till ditt Meta-konto går ut ${date}. Koppla om Meta i Admiral så snart du kan. Det tar en minut.`,
    },
    utgatt: {
      subject: 'Meta-kopplingen i Admiral har gått ut',
      heading: 'Meta-kopplingen har gått ut',
      text: `Admirals koppling till ditt Meta-konto gick ut ${date}. Koppla om Meta i Admiral så att kopplingen fungerar igen.`,
    },
  }[state];
  if (!copy) throw new Error(`Okänt läge: ${state}`);

  const html = `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#060c18;font-family:-apple-system,'Inter',sans-serif;color:#fff">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px">
    <div style="margin-bottom:32px">
      <span style="font-size:18px;font-weight:800;letter-spacing:.1em">ADMIRAL<span style="color:#00d9ff">.</span></span>
    </div>
    <div style="border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:32px">
      <h1 style="font-size:19px;font-weight:700;margin:0 0 14px;color:#fff">${copy.heading}</h1>
      <p style="font-size:14px;color:rgba(255,255,255,.7);line-height:1.7;margin:0 0 24px">
        Hej,<br><br>${copy.text}
      </p>
      <a href="https://admiralai.se/dashboard.html" style="display:inline-block;background:#00d9ff;color:#060c18;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:13px;font-weight:700">
        Koppla om Meta
      </a>
    </div>
    <div style="padding-top:24px;font-size:11px;color:rgba(255,255,255,.3);text-align:center">
      Admiral · <a href="mailto:hej@admiralai.se" style="color:rgba(255,255,255,.3)">hej@admiralai.se</a>
    </div>
  </div>
</body>
</html>`;
  return { subject: copy.subject, html };
}

/**
 * Skickar mejlet om kopplingen är i ett nytt läge. Raden i notice_log tas före utskicket
 * (unik per användare, koppling och läge), så två körningar kan inte skicka samma mejl.
 * Misslyckas utskicket tas raden bort och nästa körning försöker igen.
 */
export async function sendTokenNotice({ supabase, sendEmail, user, expiresAt, now = new Date() }) {
  const state = noticeState(expiresAt, now);
  if (!state || !user?.email) return { sent: false, state };

  const ref = noticeRef(expiresAt);
  const { data: claimed, error } = await supabase
    .from('notice_log')
    .upsert({ user_id: user.id, kind: NOTICE_KIND, ref, state }, { onConflict: 'user_id,kind,ref,state', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`notice_log: ${error.message}`);
  if (!claimed?.length) return { sent: false, state, already: true };

  const { subject, html } = buildNotice({ state, expiresAt });
  const result = await sendEmail({ to: user.email, subject, html });
  if (!result?.ok) {
    await supabase.from('notice_log').delete().eq('id', claimed[0].id);
    return { sent: false, state, error: result?.error || 'okänt fel' };
  }
  await supabase.from('notice_log').update({ email_id: result.id || null }).eq('id', claimed[0].id);
  return { sent: true, state };
}
