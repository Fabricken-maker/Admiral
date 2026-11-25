/**
 * Black Friday-vyn för DB Golf / TeeBox (ren logik + hämtning, ENDAST läsning från Meta).
 *
 * Kampanjen körs som nya annonser i de befintliga kampanjerna TB_Trafik_2026H2 (kall)
 * och TB_Varm_2026H2 (varm). Admiral skriver aldrig till Meta (DB Golf saknar skrivbehörighet):
 * här används bara graphGet.
 *
 * Vilka annonser som är Black Friday-annonser: namnet innehåller BF / Black Friday.
 * Andra annonser i samma kampanjer (t.ex. TB_ProvaPa50_*) rullar parallellt och räknas inte.
 * Spend räknas från erbjudandets första dag; det som levererats dessförinnan redovisas separat.
 */
import { graphGet, withTokens } from './meta-graph.js';
import { actionValue, PURCHASE_TYPES, addDays } from './weekly.js';

export const BF = {
  userId: 6,
  accountId: 'act_1275710539563429',
  customer: 'DB Golf / TeeBox',
  campaignNames: { cold: 'TB_Trafik_2026H2', warm: 'TB_Varm_2026H2' },
  adSetHints: { cold: 'TB_Kall_Vasteras25', warm: 'TB_Varm_Retarget' },
  // Erbjudandet gäller tis 25 – fre 27 nov 2026 (svensk vintertid, UTC+1).
  startsAt: '2026-11-25T00:00:00+01:00',
  endsAt: '2026-11-27T23:59:59+01:00',
  days: ['2026-11-25', '2026-11-26', '2026-11-27'],
  totalBudget: 2000,
  // Planerad spend per dag; resten av totalen är reserv.
  plan: { '2026-11-25': 200, '2026-11-26': 750, '2026-11-27': 950 },
  // Insights hämtas från detta datum, så att leverans före erbjudandets start kan redovisas separat.
  insightsSince: '2026-11-20',
  films: [
    { key: 'pris', title: 'BF_Pris', tagline: '6 timmar · 1 500 kr', match: /pris|1500|6tim/i, image: '/black-friday/bf_pris.jpg' },
    { key: 'spara780', title: 'BF_Spara780', tagline: 'Spara 780 kr', match: /780|spara/i, image: '/black-friday/bf_spara780.jpg' },
    { key: 'ganget', title: 'BF_Ganget', tagline: 'Fyra kompisar. Sex timmar.', match: /g[åa]nget|gang/i, image: '/black-friday/bf_ganget.jpg' },
  ],
};

const isBfName = (name = '') => /(^|[^a-z])bf([^a-z]|$)|black\s*-?\s*friday/i.test(name);

export function filmFor(adName = '') {
  return BF.films.find((f) => f.match.test(adName))?.key || null;
}

export function isBfAd(ad) {
  return isBfName(ad.name);
}

const num = (v) => Number(v || 0);

export function emptyStats() {
  return { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, results: 0, revenue: 0 };
}

function addRow(acc, row) {
  acc.spend += num(row.spend);
  acc.impressions += num(row.impressions);
  acc.clicks += num(row.clicks);
  acc.link_clicks += actionValue(row.actions, ['link_click']) || num(row.inline_link_clicks);
  // Köptyperna är samma köp (pixel): största värdet, aldrig summan.
  acc.results += actionValue(row.actions, PURCHASE_TYPES);
  acc.revenue += actionValue(row.action_values, PURCHASE_TYPES);
  return acc;
}

// Kostnad per klick (länkklick om de finns, annars alla klick) och per resultat.
export function withRatios(s) {
  const clicks = s.link_clicks || s.clicks;
  return {
    ...s,
    spend: Math.round(s.spend * 100) / 100,
    cpc: clicks > 0 ? s.spend / clicks : null,
    cost_per_result: s.results > 0 ? s.spend / s.results : null,
    ctr: s.impressions > 0 ? (clicks / s.impressions) * 100 : null,
    roas: s.spend > 0 && s.revenue > 0 ? s.revenue / s.spend : null,
  };
}

export function windowState(now = new Date()) {
  const start = new Date(BF.startsAt);
  const end = new Date(BF.endsAt);
  const state = now < start ? 'before' : now > end ? 'ended' : 'live';
  return {
    state,
    starts_at: BF.startsAt,
    ends_at: BF.endsAt,
    seconds_to_start: Math.max(0, Math.round((start - now) / 1000)),
    seconds_left: Math.max(0, Math.round((end - now) / 1000)),
  };
}

const dayLabel = (d) => {
  const names = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'];
  const dt = new Date(`${d}T12:00:00Z`);
  return `${names[dt.getUTCDay()]} ${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`;
};

/**
 * campaigns: [{id,name,status,effective_status,daily_budget,lifetime_budget}]  (båda BF-kampanjerna)
 * ads:       [{id,name,campaign_id,status,effective_status,created_time}]
 * rows:      dagliga insights på annonsnivå [{ad_id,campaign_id,date_start,spend,...}]
 */
export function buildView({ campaigns = [], ads = [], rows = [], now = new Date(), demo = false } = {}) {
  const roleOf = (campaignId) => {
    const c = campaigns.find((x) => x.id === campaignId);
    if (!c) return null;
    return c.name === BF.campaignNames.warm ? 'warm' : 'cold';
  };
  const bfAds = ads.filter(isBfAd);
  const bfIds = new Set(bfAds.map((a) => a.id));
  const allBfRows = rows.filter((r) => bfIds.has(r.ad_id));
  // Budgeten gäller erbjudandets dagar: leverans före start räknas inte in, men redovisas.
  const bfRows = allBfRows.filter((r) => r.date_start >= BF.days[0]);
  const preStartSpend = Math.round(allBfRows.filter((r) => r.date_start < BF.days[0])
    .reduce((sum, r) => sum + num(r.spend), 0) * 100) / 100;

  const tot = emptyStats();
  const perDay = new Map();
  const perAd = new Map(bfAds.map((a) => [a.id, emptyStats()]));
  const perCamp = new Map(campaigns.map((c) => [c.id, emptyStats()]));
  for (const r of bfRows) {
    addRow(tot, r);
    if (!perDay.has(r.date_start)) perDay.set(r.date_start, emptyStats());
    addRow(perDay.get(r.date_start), r);
    if (perAd.has(r.ad_id)) addRow(perAd.get(r.ad_id), r);
    if (perCamp.has(r.campaign_id)) addRow(perCamp.get(r.campaign_id), r);
  }

  // Dagar: erbjudandets tre dagar + ev. dagar utanför (t.ex. förhandsvisning) som egna rader.
  const dates = [...new Set([...BF.days, ...perDay.keys()])].sort();
  let cumulative = 0;
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  const days = dates.map((d) => {
    const s = withRatios(perDay.get(d) || emptyStats());
    cumulative += s.spend;
    const planned = BF.plan[d] ?? 0;
    return {
      date: d, label: dayLabel(d), planned, in_offer: BF.days.includes(d),
      is_today: d === today, is_future: d > today,
      ...s, cumulative: Math.round(cumulative * 100) / 100,
      vs_plan: planned ? s.spend - planned : null,
    };
  });

  const plannedTotal = Object.values(BF.plan).reduce((a, b) => a + b, 0);
  const campaignsOut = campaigns.map((c) => ({
    id: c.id, name: c.name, role: roleOf(c.id),
    ad_set_hint: BF.adSetHints[roleOf(c.id)] || null,
    status: c.effective_status || c.status,
    daily_budget: c.daily_budget ? num(c.daily_budget) / 100 : null,
    lifetime_budget: c.lifetime_budget ? num(c.lifetime_budget) / 100 : null,
    bf_ads: bfAds.filter((a) => a.campaign_id === c.id).length,
    ...withRatios(perCamp.get(c.id)),
  }));

  const adsOut = bfAds
    .map((a) => ({
      id: a.id, name: a.name, film: filmFor(a.name), role: roleOf(a.campaign_id),
      campaign_name: campaigns.find((c) => c.id === a.campaign_id)?.name || null,
      status: a.effective_status || a.status, created_time: a.created_time || null,
      ...withRatios(perAd.get(a.id)),
    }))
    .sort((x, y) => y.spend - x.spend || x.name.localeCompare(y.name));

  const filmsOut = BF.films.map((f) => {
    const mine = adsOut.filter((a) => a.film === f.key);
    const s = emptyStats();
    for (const a of mine) { s.spend += a.spend; s.impressions += a.impressions; s.clicks += a.clicks; s.link_clicks += a.link_clicks; s.results += a.results; s.revenue += a.revenue; }
    return { key: f.key, title: f.title, tagline: f.tagline, image: f.image, ads: mine.length, ...withRatios(s) };
  });

  const win = windowState(now);
  const total = withRatios(tot);
  return {
    generated_at: now.toISOString(),
    demo,
    customer: BF.customer,
    account_id: BF.accountId,
    window: win,
    budget: {
      total: BF.totalBudget,
      planned: plannedTotal,
      reserve: BF.totalBudget - plannedTotal,
      spent: total.spend,
      pre_start_spend: preStartSpend,
      left: Math.round((BF.totalBudget - total.spend) * 100) / 100,
      used_pct: Math.min(100, Math.round((total.spend / BF.totalBudget) * 1000) / 10),
    },
    totals: total,
    days,
    campaigns: campaignsOut,
    ads: adsOut,
    films: filmsOut,
    // Allt som saknas just nu, så att sidan kan säga det rakt ut i stället för att visa nollor.
    notes: [
      !campaigns.length && 'Hittar inte kampanjerna TB_Trafik_2026H2 / TB_Varm_2026H2 i kontot.',
      campaigns.length && !bfAds.length && 'Inga Black Friday-annonser hittades ännu – annonserna byggs i Annonshanteraren.',
      win.state === 'before' && 'Erbjudandet har inte börjat. Siffrorna fylls på från 25 nov.',
      preStartSpend > 0 && `Annonserna levererade för ${String(preStartSpend.toFixed(2)).replace('.', ',')} kr före 25 nov. Det ingår inte i siffrorna här.`,
    ].filter(Boolean),
  };
}

// ── Hämtning från Meta (GET) ─────────────────────────────────────────────────

async function getAll(path, params, token, fetchImpl) {
  const out = [];
  let json = await graphGet(path, params, token, fetchImpl);
  out.push(...(json.data || []));
  for (let i = 0; json.paging?.next && i < 20; i += 1) {
    const res = await fetchImpl(json.paging.next, { signal: AbortSignal.timeout(12000) });
    json = await res.json();
    if (json.error) break;
    out.push(...(json.data || []));
  }
  return out;
}

export async function fetchBlackFriday({ tokens, now = new Date(), fetchImpl = fetch }) {
  return withTokens(tokens, async (token) => {
    const names = Object.values(BF.campaignNames);
    const all = await getAll(`${BF.accountId}/campaigns`, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time', limit: 100,
    }, token, fetchImpl);
    const campaigns = all.filter((c) => names.includes(c.name));
    if (!campaigns.length) return buildView({ campaigns: [], now });

    const ids = campaigns.map((c) => c.id);
    const since = BF.insightsSince;
    const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const lastDay = addDays(BF.days.at(-1), 3);
    const until = today < lastDay ? today : lastDay;
    const [ads, rows] = await Promise.all([
      getAll(`${BF.accountId}/ads`, {
        fields: 'id,name,status,effective_status,campaign_id,adset_id,created_time', limit: 200,
        filtering: [{ field: 'campaign.id', operator: 'IN', value: ids }],
      }, token, fetchImpl),
      getAll(`${BF.accountId}/insights`, {
        level: 'ad', time_increment: 1,
        fields: 'ad_id,campaign_id,spend,impressions,clicks,inline_link_clicks,actions,action_values',
        time_range: { since: BF.insightsSince, until: until > since ? until : since },
        filtering: [{ field: 'campaign.id', operator: 'IN', value: ids }],
        limit: 500,
      }, token, fetchImpl),
    ]);
    return buildView({ campaigns, ads, rows, now });
  });
}

// ── Exempeldata (bara för förhandsvisning av utseendet; märks tydligt i sidan) ─────

export function demoInput(now = new Date('2026-11-26T20:00:00+01:00')) {
  const campaigns = [
    { id: 'c1', name: BF.campaignNames.cold, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '75000' },
    { id: 'c2', name: BF.campaignNames.warm, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '20000' },
  ];
  const ads = [
    { id: 'a1', name: 'BF_Pris', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-24T14:00:00+0100' },
    { id: 'a2', name: 'BF_Spara780', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-24T14:00:00+0100' },
    { id: 'a3', name: 'BF_Ganget', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-24T14:00:00+0100' },
    { id: 'a4', name: 'BF_Pris_Varm', campaign_id: 'c2', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-24T14:00:00+0100' },
    { id: 'a5', name: 'BF_Spara780_Varm', campaign_id: 'c2', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-24T14:00:00+0100' },
  ];
  const mk = (ad_id, campaign_id, date_start, spend, impressions, clicks, purchases) => ({
    ad_id, campaign_id, date_start, spend: String(spend), impressions: String(impressions), clicks: String(clicks),
    actions: [{ action_type: 'link_click', value: String(Math.round(clicks * 0.85)) }, ...(purchases ? [{ action_type: 'omni_purchase', value: String(purchases) }] : [])],
    action_values: purchases ? [{ action_type: 'omni_purchase', value: String(purchases * 1500) }] : [],
  });
  const rows = [
    mk('a1', 'c1', '2026-11-25', 62, 5200, 118, 0), mk('a2', 'c1', '2026-11-25', 58, 4900, 92, 0), mk('a3', 'c1', '2026-11-25', 40, 3100, 54, 0),
    mk('a4', 'c2', '2026-11-25', 24, 900, 31, 1), mk('a5', 'c2', '2026-11-25', 18, 760, 22, 0),
    mk('a1', 'c1', '2026-11-26', 262, 21000, 540, 1), mk('a2', 'c1', '2026-11-26', 231, 18800, 402, 2), mk('a3', 'c1', '2026-11-26', 170, 13900, 244, 0),
    mk('a4', 'c2', '2026-11-26', 51, 1900, 74, 2), mk('a5', 'c2', '2026-11-26', 36, 1500, 48, 0),
  ];
  return { campaigns, ads, rows, now, demo: true };
}
