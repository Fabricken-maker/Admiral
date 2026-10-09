import { redact } from './guard.js';

export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* inte JSON */ }
    return { status: res.status, ok: res.ok, json, text, headers: res.headers, ms: Date.now() - started };
  } catch (err) {
    if (err.name === 'WriteBlockedError') throw err;
    const reason = err.name === 'AbortError' ? `tidsgräns ${timeoutMs} ms` : err.message;
    return { status: 0, ok: false, json: null, text: '', error: `${reason} (${redact(url)})`, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label}: tidsgräns ${Math.round(ms / 1000)} s överskreds`), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
