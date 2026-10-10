/**
 * Spärr mot upprepade inloggningsförsök (tabell rate_limits, bara service role).
 *
 * Två nycklar per försök:
 *   login:<e-post>  högst 5 misslyckade försök på 15 minuter, sedan spärr i 15 minuter
 *   login-ip:<ip>   högst 20 misslyckade försök på 15 minuter (många konton från samma avsändare)
 * En lyckad inloggning nollställer bara e-postnyckeln, så att någon inte kan nollställa
 * avsändarens räknare genom att logga in på sitt eget konto mellan försöken.
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const BLOCK_MINUTES = 15;
export const LIMITS = { email: 5, ip: 20 };

// E-post jämförs exakt efter normalisering (alla adresser i users är sparade så).
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export function clientIp(event, context) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || context?.ip || 'okand';
}

export function blockedMinutes(row, now = Date.now()) {
  if (!row?.blocked_until) return 0;
  const ms = new Date(row.blocked_until).getTime() - now;
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

// Nästa läge efter ett misslyckat försök.
export function nextState(row, max, now = Date.now()) {
  const inWindow = row && now - new Date(row.window_start).getTime() < WINDOW_MS;
  const attempts = inWindow ? row.attempts + 1 : 1;
  return {
    attempts,
    window_start: inWindow ? row.window_start : new Date(now).toISOString(),
    blocked_until: attempts >= max ? new Date(now + BLOCK_MINUTES * 60000).toISOString() : null,
  };
}

export function createRateLimiter(supabase) {
  const read = async (key) => {
    const { data, error } = await supabase.from('rate_limits').select('key, attempts, window_start, blocked_until').eq('key', key).maybeSingle();
    if (error) throw new Error(`rate_limits: ${error.message}`);
    return data;
  };
  return {
    async check(keys) {
      const rows = await Promise.all(keys.map((k) => read(k.key)));
      return { rows, wait: Math.max(0, ...rows.map((r) => blockedMinutes(r))) };
    },
    async fail(keys, rows) {
      await Promise.all(keys.map((k, i) => supabase.from('rate_limits').upsert({ key: k.key, ...nextState(rows[i], k.max) }, { onConflict: 'key' })));
    },
    async clear(key) {
      await supabase.from('rate_limits').delete().eq('key', key);
    },
  };
}
