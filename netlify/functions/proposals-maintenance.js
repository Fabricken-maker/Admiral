/**
 * Admiral Modul D — underhåll av förslag, körs var 15:e minut (Netlify Scheduled Functions).
 *  - Väntande förslag vars giltighetstid passerat markeras "Gick ut".
 *  - Skrivningar som ännu inte bekräftats läses tillbaka från Meta (endast GET) och markeras
 *    Genomförd eller Misslyckades. Här skrivs aldrig något till Meta.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { createRepo } from './lib/write-repo.js';
import { tokensForCustomer } from './lib/token-store.js';
import { reverify } from './lib/meta-write.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async () => {
  const now = new Date().toISOString();
  const { data: expired } = await supabase.from('proposals')
    .update({ status: 'expired', updated_at: now })
    .eq('status', 'pending').lt('valid_until', now).select('id');

  const repo = createRepo(supabase);
  const { data: open } = await supabase.from('meta_write_log').select('*').eq('status', 'verifying')
    .lt('created_at', new Date(Date.now() - 60000).toISOString());
  const reverified = [];
  for (const w of open || []) {
    try {
      reverified.push({ id: w.id, status: await reverify({ repo, writeLog: w, tokens: await tokensForCustomer(supabase, w.user_id) }) });
    } catch (e) {
      reverified.push({ id: w.id, error: e.message });
    }
  }
  return { statusCode: 200, body: JSON.stringify({ expired: (expired || []).length, reverified }) };
};

export default modern(handler);
