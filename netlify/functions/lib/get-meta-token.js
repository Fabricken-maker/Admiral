import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function getMetaToken(userId) {
  const { data, error } = await supabase
    .from('meta_tokens')
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new Error('Inget Meta-konto kopplat — gå till inställningar och koppla ditt Meta-konto');

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new Error('Meta-token har gått ut — logga in och koppla Meta igen');
  }

  return data.access_token;
}
