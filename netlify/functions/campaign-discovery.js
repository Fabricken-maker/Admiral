/**
 * Admiral — Kampanjupptäckt, körs nattligen 04:15 UTC (före recommendations-sync,
 * weekly-sync och budget-adjust så att nya planer finns när de jobben går).
 *
 * Hittar kundernas kampanjer i Meta och speglar dem i budget_plans (se lib/campaign-discovery.js).
 * Endast läsning mot Meta. Fel per kund loggas i health_reports (kategori campaign_discovery).
 *
 * Körs också för EN kund direkt efter Meta-omkoppling: POST med signerat internt anrop
 * (lib/internal-auth.js) och body { user_id } från meta-oauth-callback.
 */
import { createClient } from '@supabase/supabase-js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { verifyInternal, HEADER } from './lib/internal-auth.js';
import { accountsPerCustomer, backfillAdAccounts, discoverAccount } from './lib/campaign-discovery.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const sanitize = (s) => String(s || '').replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]');

const handler = async (event) => {
  const today = new Date().toISOString().split('T')[0];

  // Internt anrop efter omkoppling → bara den kunden. Annars (schemat) → alla kunder.
  let onlyUserId = null;
  if (event?.httpMethod === 'POST' && verifyInternal(event.headers?.[HEADER])) {
    try { onlyUserId = Number(JSON.parse(event.body || '{}').user_id) || null; } catch { /* hela körningen */ }
  }

  const { data: admin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
  let customers;
  try {
    customers = await accountsPerCustomer(supabase);
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: sanitize(err.message) }) };
  }
  if (onlyUserId) customers = customers.filter((c) => c.userId === onlyUserId);

  const results = [];
  for (const customer of customers) {
    try {
      const tokens = await tokensForCustomer(supabase, customer.userId);
      if (!tokens.length) throw new Error('Ingen giltig Meta-koppling');

      // Onboarding/omkoppling kan ha missat users.meta_ad_account_id — fyll från weekly_settings.
      if (!customer.hasPrimary && customer.weeklyAccounts.length) {
        await backfillAdAccounts(supabase, customer.userId).catch(() => {});
      }

      const accounts = [];
      for (const adAccountId of customer.accounts) {
        accounts.push(await discoverAccount({ supabase, userId: customer.userId, adAccountId, tokens }));
      }
      results.push({ user_id: customer.userId, accounts });
    } catch (err) {
      const message = sanitize(err.message || err);
      results.push({ user_id: customer.userId, error: message });
      if (admin) {
        await supabase.from('health_reports').insert({
          report_date: today,
          user_id: admin.id,
          severity: 'warning',
          category: 'campaign_discovery',
          message: `Kampanjupptäckten misslyckades för kund ${customer.userId}`,
          details: { error: message },
        });
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ discovered: results }) };
};

export default modern(handler);
