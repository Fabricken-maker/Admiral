/**
 * Kontroll av varje inloggad begäran mot databasen. Körs för alla funktioner via modern.js.
 *
 * En giltig JWT räcker inte. Användaren måste också finnas, vara aktiv och ha samma e-post som
 * i JWT:n, så att en pausad, avslutad eller borttagen användare stängs ute direkt i stället för
 * när JWT:n går ut (24 h). Admin avgörs av e-posten i JWT:n, och den stämmer då alltid med databasen.
 *
 *   användaren finns inte, eller har annan e-post → 401
 *   pausad eller avslutad                         → 403
 * En begäran utan JWT, eller med en JWT som inte går att verifiera, släpps vidare oförändrad:
 * funktionen avgör själv (401, offentlig sida, MCP-nyckel, internt anrop).
 * Svaret från databasen sparas i 60 sekunder per funktionsinstans.
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

export const CACHE_MS = 60000;
const cache = new Map();
let client;

async function lookupUser(id) {
  client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await client.from('users').select('id, email, status').eq('id', id).maybeSingle();
  if (error) throw new Error(`users: ${error.message}`);
  return data;
}

export function decision(user, claims) {
  if (!user) return { status: 401, error: 'Unauthorized' };
  if (String(user.email || '').toLowerCase() !== String(claims.email || '').toLowerCase()) return { status: 401, error: 'Unauthorized' };
  if (user.status === 'paused') return { status: 403, error: 'Ditt konto är pausat. Kontakta Admiral för att återaktivera.' };
  if (user.status === 'terminated') return { status: 403, error: 'Detta konto har avslutats.' };
  return null;
}

export async function authGuard(event, { lookup, now = Date.now(), secret = process.env.JWT_SECRET } = {}) {
  const header = event.headers?.authorization || '';
  if (!header.startsWith('Bearer ') || !secret) return null;
  if (!lookup && !process.env.SUPABASE_URL) return null;
  let claims;
  try {
    claims = jwt.verify(header.slice(7), secret);
  } catch {
    return null;
  }
  if (!claims?.id) return null;

  const key = String(claims.id);
  let entry = cache.get(key);
  if (!entry || now - entry.at > CACHE_MS) {
    entry = { at: now, user: await (lookup || lookupUser)(claims.id) };
    cache.set(key, entry);
  }
  const d = decision(entry.user, claims);
  return d ? { statusCode: d.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: d.error }) } : null;
}

export const clearAuthCache = () => cache.clear();
