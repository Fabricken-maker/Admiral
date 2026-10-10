/**
 * Admiral Modul E — läser veckosiffror per annons från Meta (endast GET).
 */
import { graphGet } from './meta-graph.js';
import { addDays, lastCompletedWeekStart } from './weekly.js';

const FIELDS = 'ad_id,ad_name,adset_id,campaign_id,campaign_name,impressions,reach,frequency,inline_link_clicks,clicks,spend,actions';

// Veckor mån–sön (kontots tidszon, alla Admirals konton har Europe/Stockholm) för aktiva annonser.
export async function weeklyAdInsights(accountId, token, { weeks, now = new Date(), get = graphGet } = {}) {
  const last = lastCompletedWeekStart(now);
  const since = addDays(last, -7 * (weeks - 1));
  const rows = [];
  let after;
  do {
    const page = await get(`${accountId}/insights`, {
      level: 'ad',
      time_increment: 7,
      time_range: { since, until: addDays(last, 6) },
      fields: FIELDS,
      filtering: [{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }],
      limit: 500,
      after,
    }, token);
    rows.push(...(page.data || []));
    after = page.paging?.next ? page.paging.cursors?.after : null;
  } while (after);
  return { rows, lastWeekStart: last };
}

// Siffror för en annons under en period (för uppföljningen efter ett byte).
export async function adPeriod(adId, since, until, token, get = graphGet) {
  const res = await get(`${adId}/insights`, { time_range: { since, until }, fields: FIELDS }, token);
  return res.data?.[0] || null;
}
