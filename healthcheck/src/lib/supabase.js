// Minimal PostgREST-klient med service-nyckel. Skrivningar begränsas av guard.js.
import { fetchJson } from './http.js';

export function createSupabase({ url, key, timeoutMs = 20_000 }) {
  const rest = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function select(table, query = 'select=*') {
    const res = await fetchJson(`${rest}/${table}?${query}`, { headers, timeoutMs });
    if (!res.ok) throw new Error(`Supabase ${table}: HTTP ${res.status} ${res.json?.message || res.error || ''}`.trim());
    return res.json;
  }

  // Finns tabellen och går den att läsa? Returnerar { ok, status, message }.
  async function probe(table) {
    const res = await fetchJson(`${rest}/${table}?select=*&limit=0`, { headers, timeoutMs });
    return { ok: res.ok, status: res.status, message: res.json?.message || res.error || '' };
  }

  async function patch(table, filter, body) {
    const res = await fetchJson(`${rest}/${table}?${filter}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(body),
      timeoutMs,
    });
    if (!res.ok) throw new Error(`Supabase PATCH ${table}: HTTP ${res.status} ${res.json?.message || ''}`.trim());
    return res.json;
  }

  async function insert(table, rows) {
    const res = await fetchJson(`${rest}/${table}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(rows),
      timeoutMs,
    });
    if (!res.ok) throw new Error(`Supabase INSERT ${table}: HTTP ${res.status} ${res.json?.message || ''}`.trim());
    return res.json;
  }

  // RPC: GET för läsfunktioner (STABLE), POST för meta_token_put (spärren tillåter bara den).
  async function rpc(fn, args = {}, { write = false } = {}) {
    const res = write
      ? await fetchJson(`${rest}/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), timeoutMs })
      : await fetchJson(`${rest}/rpc/${fn}?${new URLSearchParams(args)}`, { headers, timeoutMs });
    if (!res.ok) throw new Error(`Supabase rpc ${fn}: HTTP ${res.status} ${res.json?.message || ''}`.trim());
    return res.json;
  }

  return { select, probe, patch, insert, rpc };
}
