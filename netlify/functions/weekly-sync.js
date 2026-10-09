/**
 * Admiral Modul C — Veckosynk, körs dagligen via Netlify Scheduled Functions.
 * Läser veckosiffror från Meta (endast GET) och sparar dem i weekly_metrics.
 * Preliminära veckor räknas om varje dygn tills de hämtats 72 h efter veckoslut.
 */
import { createClient } from '@supabase/supabase-js';
import { getMetaToken } from './lib/get-meta-token.js';
import { syncCustomer } from './lib/weekly-sync.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

// Kundens eget Meta-token först, sedan Fabrickens (admin) som har åtkomst till kundkontona.
async function tokensFor(userId, adminId) {
  const ids = [userId, adminId].filter((id, i, a) => id && a.indexOf(id) === i);
  const tokens = [];
  for (const id of ids) {
    try { tokens.push(await getMetaToken(id)); } catch { /* saknas eller utgånget */ }
  }
  return tokens;
}

export const handler = async () => {
  const today = new Date().toISOString().split('T')[0];
  const { data: admin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
  const { data: customers, error } = await supabase.from('weekly_settings').select('*').eq('active', true);
  if (error) return { statusCode: 500, body: error.message };

  const results = [];
  for (const settings of customers || []) {
    try {
      const tokens = await tokensFor(settings.user_id, admin?.id);
      results.push(await syncCustomer({ supabase, settings, tokens }));
    } catch (err) {
      const message = String(err.message || err).replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]');
      results.push({ user_id: settings.user_id, error: message });
      if (admin) {
        await supabase.from('health_reports').insert({
          report_date: today,
          user_id: admin.id,
          severity: 'warning',
          category: 'weekly_sync',
          message: `Veckosynken misslyckades för kund ${settings.user_id}`,
          details: { error: message },
        });
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ synced: results }) };
};
