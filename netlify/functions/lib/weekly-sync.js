/**
 * Admiral Modul C — synk av veckosiffror från Meta till weekly_metrics (endast läsning mot Meta).
 *
 * Per kund och annonskonto hämtas de senaste avslutade veckorna (mån–sön) med
 * time_increment=7, både som kontosumma (campaign_id = '_konto') och per kampanj.
 * Veckor som saknas eller fortfarande är preliminära skrivs om. Slutliga veckor
 * (hämtade minst 72 h efter veckoslut) lämnas orörda.
 */
import {
  TOTAL_ID, WEEKS_SHOWN, PURCHASE_TYPES, addDays, completedWeekStarts, isPreliminary, weekValuesFromInsight,
} from './weekly.js';

const GRAPH = 'https://graph.facebook.com/v25.0';
const META_TIMEOUT_MS = 15000;

async function graphGetAll(path, params, token, fetchImpl) {
  const out = [];
  let url = `${GRAPH}/${path}?${new URLSearchParams({ ...params, limit: '500', access_token: token })}`;
  for (let page = 0; url && page < 10; page++) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(META_TIMEOUT_MS) });
    const json = await res.json();
    if (json.error) {
      const e = new Error(`Meta: ${json.error.message}`);
      e.metaCode = json.error.code;
      throw e;
    }
    out.push(...(json.data || []));
    url = json.paging?.next || null;
  }
  return out;
}

export async function fetchAccountWeeks(adAccountId, weeks, token, fetchImpl = fetch) {
  const common = {
    time_range: JSON.stringify({ since: weeks[0], until: addDays(weeks.at(-1), 6) }),
    time_increment: '7',
  };
  const [account, campaigns] = await Promise.all([
    graphGetAll(`${adAccountId}/insights`, { ...common, level: 'account', fields: 'spend,impressions,actions,action_values' }, token, fetchImpl),
    graphGetAll(`${adAccountId}/insights`, { ...common, level: 'campaign', fields: 'campaign_id,campaign_name,spend,impressions,actions,action_values' }, token, fetchImpl),
  ]);
  const known = new Set(weeks);
  for (const r of [...account, ...campaigns]) {
    if (!known.has(r.date_start) || r.date_stop !== addDays(r.date_start, 6)) {
      throw new Error(`Meta returnerade perioden ${r.date_start}–${r.date_stop}, inte en hel vecka mån–sön`);
    }
  }
  return { account, campaigns };
}

/**
 * Rader att skriva för veckorna i weeksToWrite.
 * existing: befintliga kampanjrader för kontot — kampanjer som inte längre finns hos Meta
 * för en vecka nollställs i stället för att ligga kvar med gamla siffror.
 */
export function buildRows({ userId, adAccountId, weeksToWrite, insights, resultTypes = PURCHASE_TYPES, fetchedAt, existing = [] }) {
  const out = [];
  const base = (weekStart) => ({
    user_id: userId,
    ad_account_id: adAccountId,
    week_start: weekStart,
    week_end: addDays(weekStart, 6),
    fetched_at: fetchedAt,
    is_preliminary: isPreliminary(weekStart, fetchedAt),
  });
  const raw = (r) => ({ actions: r?.actions || [], action_values: r?.action_values || [] });

  for (const w of weeksToWrite) {
    const acc = insights.account.find((r) => r.date_start === w);
    out.push({ ...base(w), campaign_id: TOTAL_ID, campaign_name: null, ...weekValuesFromInsight(acc, resultTypes), ...raw(acc) });

    const seen = new Set();
    for (const r of insights.campaigns.filter((x) => x.date_start === w)) {
      seen.add(r.campaign_id);
      out.push({ ...base(w), campaign_id: r.campaign_id, campaign_name: r.campaign_name || null, ...weekValuesFromInsight(r, resultTypes), ...raw(r) });
    }
    for (const e of existing.filter((x) => x.week_start === w && x.campaign_id !== TOTAL_ID && !seen.has(x.campaign_id))) {
      out.push({ ...base(w), campaign_id: e.campaign_id, campaign_name: e.campaign_name, ...weekValuesFromInsight({}, resultTypes), ...raw(null) });
    }
  }
  return out;
}

/**
 * Synkar en kund. tokens: Meta-token i prioritetsordning (kundens eget först, sedan Fabrickens).
 * Ett ogiltigt token (Meta-felkod 190) gör att nästa provas.
 */
export async function syncCustomer({ supabase, settings, tokens, now = new Date(), fetchImpl = fetch }) {
  const weeks = completedWeekStarts(WEEKS_SHOWN, now);
  const fetchedAt = now.toISOString();
  const resultTypes = settings.result_action_types?.length ? settings.result_action_types : PURCHASE_TYPES;
  const summary = { user_id: settings.user_id, accounts: [] };

  const { data: existing, error } = await supabase
    .from('weekly_metrics')
    .select('ad_account_id,campaign_id,campaign_name,week_start,is_preliminary')
    .eq('user_id', settings.user_id)
    .gte('week_start', weeks[0]);
  if (error) throw new Error(`weekly_metrics: ${error.message}`);

  for (const adAccountId of settings.ad_account_ids || []) {
    const mine = existing.filter((r) => r.ad_account_id === adAccountId);
    const final = new Set(mine.filter((r) => r.campaign_id === TOTAL_ID && !r.is_preliminary).map((r) => r.week_start));
    const weeksToWrite = weeks.filter((w) => !final.has(w));
    if (!weeksToWrite.length) {
      summary.accounts.push({ ad_account_id: adAccountId, written: 0, weeks: [] });
      continue;
    }

    let insights;
    let lastErr;
    for (const token of tokens.filter(Boolean)) {
      try {
        insights = await fetchAccountWeeks(adAccountId, weeks, token, fetchImpl);
        break;
      } catch (e) {
        lastErr = e;
        if (e.metaCode !== 190) throw e; // bara ogiltigt token ger nästa token en chans
      }
    }
    if (!insights) throw lastErr || new Error('Inget Meta-token att läsa med');

    const rows = buildRows({ userId: settings.user_id, adAccountId, weeksToWrite, insights, resultTypes, fetchedAt, existing: mine });
    const { error: upErr } = await supabase
      .from('weekly_metrics')
      .upsert(rows, { onConflict: 'user_id,ad_account_id,campaign_id,week_start' });
    if (upErr) throw new Error(`weekly_metrics upsert: ${upErr.message}`);
    summary.accounts.push({ ad_account_id: adAccountId, written: rows.length, weeks: weeksToWrite });
  }
  return summary;
}
