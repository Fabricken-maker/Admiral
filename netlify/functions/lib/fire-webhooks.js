/**
 * Admiral Webhook Dispatcher
 * Skickar events till registrerade webhooks med HMAC-SHA256-signatur
 *
 * Header: X-Admiral-Signature: sha256=<hex>
 * Header: X-Admiral-Event: account.inactive
 * Header: X-Admiral-Timestamp: 1234567890
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Skickar ett event till alla webhooks som prenumererar på det
 * @param {string} event  — t.ex. 'account.inactive'
 * @param {object} payload — data att skicka
 */
export async function fireWebhook(event, payload) {
  const { data: subs } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, secret')
    .eq('active', true)
    .contains('events', [event]);

  if (!subs?.length) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event, timestamp, data: payload });

  await Promise.allSettled(subs.map(async sub => {
    const sig = 'sha256=' + crypto
      .createHmac('sha256', sub.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    let status = 0;
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admiral-Signature': sig,
          'X-Admiral-Event': event,
          'X-Admiral-Timestamp': String(timestamp)
        },
        body,
        signal: AbortSignal.timeout(8000)
      });
      status = res.status;
    } catch (e) {
      status = 0;
    }

    await supabase.from('webhook_subscriptions').update({
      last_fired_at: new Date().toISOString(),
      last_status: status
    }).eq('id', sub.id);
  }));
}
