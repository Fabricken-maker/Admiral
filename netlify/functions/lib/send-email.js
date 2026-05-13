/**
 * Admiral Email Helper — skickar transaktionella mail via Resend
 * Används av nightly-health-check, auth-register och andra funktioner
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = 'Admiral <noreply@admiralai.se>';

/**
 * Skickar ett e-postmeddelande via Resend API
 * @param {Object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    console.warn('[send-email] RESEND_API_KEY saknas — mail skickas inte');
    return { ok: false, error: 'RESEND_API_KEY saknas' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(text ? { text } : {})
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || JSON.stringify(data));
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[send-email] Fel:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * E-postmall: Daglig hälsorapport till admin
 */
export function buildAdminDailyReport({ date, findings, criticals, warnings, users }) {
  const criticalList = findings.filter(f => f.severity === 'critical');
  const warningList  = findings.filter(f => f.severity === 'warning');
  const infoList     = findings.filter(f => f.severity === 'info');

  const severityColor = { critical: '#f87171', warning: '#f0c040', info: '#34d399' };
  const severityLabel = { critical: '🔴 Kritisk', warning: '🟡 Varning', info: '🟢 Info' };

  const rows = (list) => list.map(f => `
    <tr>
      <td style="padding:6px 10px;font-size:13px;color:${severityColor[f.severity]};white-space:nowrap">${severityLabel[f.severity]}</td>
      <td style="padding:6px 10px;font-size:13px;color:#e2e8f0">${f.message}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#060c18;font-family:-apple-system,'Inter',sans-serif;color:#fff">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">

    <div style="margin-bottom:28px">
      <span style="font-size:18px;font-weight:800;letter-spacing:.1em">ADMIRAL<span style="color:#4fc3f7">.</span></span>
    </div>

    <h1 style="font-size:20px;font-weight:700;margin:0 0 4px">Daglig hälsorapport</h1>
    <p style="font-size:13px;color:rgba(255,255,255,.4);margin:0 0 24px">${date} · ${users} kunder kontrollerade</p>

    <!-- Summary badges -->
    <div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap">
      <div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center">
        <div style="font-size:24px;font-weight:800;color:#f87171">${criticals}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Kritiska</div>
      </div>
      <div style="background:rgba(240,192,64,.1);border:1px solid rgba(240,192,64,.3);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center">
        <div style="font-size:24px;font-weight:800;color:#f0c040">${warnings}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Varningar</div>
      </div>
      <div style="background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center">
        <div style="font-size:24px;font-weight:800;color:#34d399">${infoList.length}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Info</div>
      </div>
    </div>

    ${criticalList.length ? `
    <div style="margin-bottom:20px">
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#f87171;margin:0 0 8px">Kritiska problem</h2>
      <table style="width:100%;border-collapse:collapse;background:rgba(248,113,113,.05);border:1px solid rgba(248,113,113,.2);border-radius:8px;overflow:hidden">
        ${rows(criticalList)}
      </table>
    </div>` : ''}

    ${warningList.length ? `
    <div style="margin-bottom:20px">
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#f0c040;margin:0 0 8px">Varningar</h2>
      <table style="width:100%;border-collapse:collapse;background:rgba(240,192,64,.05);border:1px solid rgba(240,192,64,.2);border-radius:8px;overflow:hidden">
        ${rows(warningList)}
      </table>
    </div>` : ''}

    ${!criticalList.length && !warningList.length ? `
    <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.2);border-radius:10px;padding:20px;text-align:center;margin-bottom:20px">
      <div style="font-size:22px;margin-bottom:6px">✅</div>
      <div style="font-size:14px;color:#34d399;font-weight:600">Allt ser bra ut!</div>
      <div style="font-size:12px;color:rgba(255,255,255,.4);margin-top:4px">Inga kritiska problem eller varningar idag</div>
    </div>` : ''}

    <a href="https://admiralai.se/admin.html" style="display:inline-block;background:#1a6ae0;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:13px;font-weight:700;margin-bottom:32px">
      Öppna Admin →
    </a>

    <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:16px;font-size:11px;color:rgba(255,255,255,.25);text-align:center">
      Admiral · <a href="mailto:hej@admiralai.se" style="color:rgba(255,255,255,.25)">hej@admiralai.se</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * E-postmall: Token löper ut (till kund)
 */
export function buildTokenExpiryEmail({ name, daysLeft, severity }) {
  const isUrgent = severity === 'critical';
  const accentColor = isUrgent ? '#f87171' : '#f0c040';

  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#060c18;font-family:-apple-system,'Inter',sans-serif;color:#fff">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">

    <div style="margin-bottom:28px">
      <span style="font-size:18px;font-weight:800;letter-spacing:.1em">ADMIRAL<span style="color:#4fc3f7">.</span></span>
    </div>

    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:28px">
      <div style="font-size:28px;margin-bottom:12px">${isUrgent ? '🔴' : '🟡'}</div>
      <h1 style="font-size:19px;font-weight:700;margin:0 0 10px;color:${accentColor}">
        ${isUrgent ? 'Ditt Meta-konto kopplas bort snart' : 'Ditt Meta-token löper ut snart'}
      </h1>
      <p style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.65;margin:0 0 20px">
        Hej ${name || 'där'},<br><br>
        Ditt Meta-token löper ut om <strong style="color:${accentColor}">${daysLeft} dag${daysLeft !== 1 ? 'ar' : ''}</strong>.
        ${isUrgent
          ? ' Admiral kan inte längre optimera dina kampanjer efter det.'
          : ' Förnya det i tid för att undvika avbrott i din annonsoptimering.'}
      </p>
      <a href="https://admiralai.se/dashboard.html" style="display:inline-block;background:#1a6ae0;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:13px;font-weight:700">
        Förnya Meta-koppling →
      </a>
    </div>

    <div style="padding-top:20px;font-size:11px;color:rgba(255,255,255,.25);text-align:center">
      Admiral · <a href="mailto:hej@admiralai.se" style="color:rgba(255,255,255,.25)">hej@admiralai.se</a>
      · <a href="https://admiralai.se" style="color:rgba(255,255,255,.25)">admiralai.se</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * E-postmall: Välkomstmail (skickas vid registrering)
 */
export function buildWelcomeEmail({ name }) {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#060c18;font-family:-apple-system,'Inter',sans-serif;color:#fff">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">

    <div style="margin-bottom:28px">
      <span style="font-size:18px;font-weight:800;letter-spacing:.1em">ADMIRAL<span style="color:#4fc3f7">.</span></span>
    </div>

    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:28px">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 12px">Välkommen till Admiral, ${name || 'där'}! 👋</h1>
      <p style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.65;margin:0 0 16px">
        Ditt konto är nu skapat. Nästa steg är att koppla ditt Meta-annonskonto så att Admiral kan börja optimera dina kampanjer automatiskt.
      </p>
      <p style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.65;margin:0 0 24px">
        Det tar ungefär 2 minuter och kräver ingen kod.
      </p>
      <a href="https://admiralai.se/setup-wizard.html" style="display:inline-block;background:#1a6ae0;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:13px;font-weight:700">
        Kom igång →
      </a>
    </div>

    <div style="padding-top:20px;font-size:11px;color:rgba(255,255,255,.25);text-align:center">
      Admiral · <a href="mailto:hej@admiralai.se" style="color:rgba(255,255,255,.25)">hej@admiralai.se</a>
    </div>
  </div>
</body>
</html>`;
}
