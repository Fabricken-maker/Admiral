// Skrivspärr för hela modulen. Installeras först av allt och lindar global fetch.
//
// Regler:
//  - Meta (facebook.com) är skrivskyddat: bara GET, och aldrig method-override
//    (?method=post|delete) eller batch-anrop.
//  - Admiral: bara GET, utom inloggningsproben POST /auth/login.
//  - Supabase: aldrig DELETE, aldrig SQL/RPC. Skrivning bara till tabeller i
//    SUPABASE_WRITE_RULES, med tillåten metod per tabell.
//  - Övriga värdar: GET, plus Telegram sendMessage.
// Allt annat kastar WriteBlockedError innan något nätverksanrop görs.

export class WriteBlockedError extends Error {
  constructor(method, url, reason) {
    super(`Skrivspärr: ${method} ${redact(url)} — ${reason}`);
    this.name = 'WriteBlockedError';
  }
}

export const SUPABASE_WRITE_RULES = {
  admiral_healthchecks: ['POST', 'PATCH'],
  spend_log: ['PATCH'],
  budget_plans: ['PATCH'],
  meta_tokens: ['PATCH'],
  weekly_metrics: ['PATCH', 'POST'], // omsynk av veckorader från Meta (Modul C)
};

// Enda RPC som får skriva: lagrar ett Meta-token krypterat i Vault (förnyelse/kryptering).
export const SUPABASE_WRITE_RPC = ['meta_token_put'];

export function redact(url) {
  return String(url)
    .replace(/(access_token|input_token|fb_exchange_token|client_secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .replace(/bot\d+:[\w-]+/g, 'bot[REDACTED]');
}

function isMetaHost(host) {
  return host === 'facebook.com' || host.endsWith('.facebook.com') || host.endsWith('.fbcdn.net');
}

export function checkRequest(method, rawUrl, { baseUrl, supabaseUrl } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();

  if (isMetaHost(host)) {
    if (m !== 'GET' && m !== 'HEAD') throw new WriteBlockedError(m, rawUrl, 'Meta är skrivskyddat');
    for (const [k, v] of url.searchParams) {
      if (k.toLowerCase() === 'method' && String(v).toUpperCase() !== 'GET') {
        throw new WriteBlockedError(m, rawUrl, 'method-override mot Meta är spärrat');
      }
      if (k.toLowerCase() === 'batch') throw new WriteBlockedError(m, rawUrl, 'batch-anrop mot Meta är spärrat');
    }
    return;
  }

  if (supabaseUrl && host === new URL(supabaseUrl).hostname.toLowerCase()) {
    if (m === 'GET' || m === 'HEAD') return;
    if (m === 'DELETE') throw new WriteBlockedError(m, rawUrl, 'radering i Supabase är spärrat');
    if (m === 'POST' && SUPABASE_WRITE_RPC.includes(url.pathname.replace(/^\/rest\/v1\/rpc\//, ''))) return;
    const match = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/);
    if (!match) throw new WriteBlockedError(m, rawUrl, 'endast REST-tabellskrivning är tillåten (ingen SQL/RPC/auth)');
    const allowed = SUPABASE_WRITE_RULES[match[1]];
    if (!allowed || !allowed.includes(m)) {
      throw new WriteBlockedError(m, rawUrl, `skrivning till ${match[1]} med ${m} är inte tillåten`);
    }
    return;
  }

  if (baseUrl && host === new URL(baseUrl).hostname.toLowerCase()) {
    if (m === 'GET' || m === 'HEAD') return;
    if (m === 'POST' && url.pathname === '/auth/login') return; // inloggningsprob med påhittat konto
    throw new WriteBlockedError(m, rawUrl, 'endast läsning mot Admiral');
  }

  if (host === 'api.telegram.org') {
    if (m === 'GET' || (m === 'POST' && /\/sendMessage$/.test(url.pathname))) return;
    throw new WriteBlockedError(m, rawUrl, 'endast sendMessage mot Telegram');
  }

  if (m === 'GET' || m === 'HEAD') return;
  throw new WriteBlockedError(m, rawUrl, 'okänd värd — endast läsning');
}

let installed = false;
export function installGuard(opts) {
  if (installed) return;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function guardedFetch(input, init = {}) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = init.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    checkRequest(method, url, opts);
    return realFetch(input, init);
  };
  installed = true;
}
