/**
 * Läsning från Meta Marketing API (endast GET). Skrivningar finns bara i lib/meta-write.js.
 */
export const GRAPH = 'https://graph.facebook.com/v25.0';
const TIMEOUT_MS = 12000;

export class MetaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MetaError';
    this.metaCode = code;
  }
}

export async function graphGet(path, params, token, fetchImpl = fetch) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  qs.set('access_token', token);
  const res = await fetchImpl(`${GRAPH}/${path}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = await res.json();
  if (json.error) throw new MetaError(`Meta: ${json.error.message}`, json.error.code);
  return json;
}

// Provar token i tur och ordning; ett ogiltigt token (felkod 190) ger nästa token en chans.
export async function withTokens(tokens, fn) {
  let last;
  for (const t of tokens) {
    try {
      return await fn(t.token ?? t);
    } catch (e) {
      last = e;
      if (e.metaCode !== 190) throw e;
    }
  }
  throw last || new MetaError('Inget giltigt Meta-token att använda', 190);
}

// Objektets egna siffror för en period (spend, resultat, intäkt).
export async function objectStats(objectId, days, resultTypes, token, fetchImpl = fetch) {
  const json = await graphGet(`${objectId}/insights`, { fields: 'spend,actions,action_values', date_preset: `last_${days}d` }, token, fetchImpl);
  const row = json.data?.[0] || {};
  const pick = (list) => (list || []).filter((a) => resultTypes.includes(a.action_type)).reduce((m, a) => Math.max(m, Number(a.value || 0)), 0);
  return { days, spend: Number(row.spend || 0), results: pick(row.actions), revenue: pick(row.action_values) };
}
