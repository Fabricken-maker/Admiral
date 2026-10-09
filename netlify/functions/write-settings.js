/**
 * Admiral Modul D — skrivbehörighet, nödstopp och gränser per kund
 *
 * GET  /api/write-settings[?user_id=]   → inställningar + tokenstatus (admin: valfri kund)
 * PUT  /api/write-settings              → (admin) ändra { user_id, writes_enabled, ad_account_ids, gränser … }
 * POST /api/write-settings/stop         → nödstopp PÅ (kunden själv eller admin). Gäller omedelbart.
 * POST /api/write-settings/resume       → nödstopp AV (bara admin)
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { readToken } from './lib/token-store.js';
import { normalizeWriteSettings, DEFAULT_WRITE_SETTINGS } from './lib/proposals.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';
const EDITABLE = Object.keys(DEFAULT_WRITE_SETTINGS).filter((k) => k !== 'kill_switch');

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, PUT, POST, OPTIONS');
  const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  let actor;
  try {
    const p = jwt.verify((event.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
    actor = { id: p.id, isAdmin: p.email === ADMIN_EMAIL };
  } catch {
    return json(401, { error: 'Unauthorized' });
  }
  const q = event.queryStringParameters || {};
  const action = (event.path || '').replace(/^.*\/write-settings\/?/, '');
  const body = event.body ? JSON.parse(event.body) : {};
  const customerId = Number(q.user_id || body.user_id || actor.id);
  if (customerId !== actor.id && !actor.isAdmin) return json(403, { error: 'Åtkomst nekad' });

  const current = async () => (await supabase.from('write_settings').select('*').eq('user_id', customerId).maybeSingle()).data;

  if (event.httpMethod === 'GET') {
    const row = await current();
    return json(200, { user_id: customerId, settings: { ...normalizeWriteSettings(row), kill_switch_at: row?.kill_switch_at || null }, token: await tokenStatus(customerId) });
  }

  if (event.httpMethod === 'POST' && action === 'stop') {
    const now = new Date().toISOString();
    const { error } = await supabase.from('write_settings').upsert({ user_id: customerId, kill_switch: true, kill_switch_at: now, kill_switch_by: actor.id, updated_at: now }, { onConflict: 'user_id' });
    if (error) return json(500, { error: error.message });
    return json(200, { kill_switch: true, message: 'Alla ändringar i Meta är stoppade.' });
  }

  if (!actor.isAdmin) return json(403, { error: 'Bara Fabricken kan ändra skrivinställningar.' });

  if (event.httpMethod === 'POST' && action === 'resume') {
    const now = new Date().toISOString();
    const { error } = await supabase.from('write_settings').update({ kill_switch: false, kill_switch_at: null, kill_switch_by: actor.id, updated_at: now }).eq('user_id', customerId);
    if (error) return json(500, { error: error.message });
    return json(200, { kill_switch: false });
  }

  if (event.httpMethod === 'PUT') {
    const patch = { user_id: customerId, updated_at: new Date().toISOString() };
    for (const k of EDITABLE) if (body[k] !== undefined) patch[k] = body[k];
    const { data, error } = await supabase.from('write_settings').upsert(patch, { onConflict: 'user_id' }).select().single();
    if (error) return json(400, { error: error.message });
    return json(200, { settings: normalizeWriteSettings(data) });
  }

  return json(405, { error: 'Method not allowed' });
};

// Tydlig status per kund: vilket token skrivningar görs med, om det gäller och har ads_management.
async function tokenStatus(userId) {
  const { data: admin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
  const out = [];
  for (const [label, id] of [['Kundens eget', userId], ['Fabricken', admin?.id]]) {
    if (!id || (label === 'Fabricken' && id === userId)) continue;
    const row = await readToken(supabase, id).catch(() => null);
    if (!row) { out.push({ source: label, connected: false }); continue; }
    let valid = false;
    let canWrite = false;
    try {
      const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
      const r = await fetch(`https://graph.facebook.com/v25.0/debug_token?input_token=${encodeURIComponent(row.access_token)}&access_token=${encodeURIComponent(appToken)}`, { signal: AbortSignal.timeout(8000) });
      const d = (await r.json()).data || {};
      valid = !!d.is_valid;
      canWrite = valid && (d.scopes || []).includes('ads_management');
    } catch { /* okänt */ }
    out.push({ source: label, connected: true, valid, can_write: canWrite, encrypted: row.encrypted, expires_at: row.expires_at });
  }
  return out;
}

export default modern(handler);
