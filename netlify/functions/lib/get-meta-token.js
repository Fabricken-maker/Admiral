import { createClient } from '@supabase/supabase-js';
import { readToken } from './token-store.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function getMetaToken(userId) {
  const data = await readToken(supabase, userId).catch(() => null);

  if (!data) throw new Error('Inget Meta-konto kopplat — gå till inställningar och koppla ditt Meta-konto');

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new Error('Meta-token har gått ut — logga in och koppla Meta igen');
  }

  return data.access_token;
}
