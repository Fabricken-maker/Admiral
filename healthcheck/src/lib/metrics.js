// Kanonisk tolkning av Meta-insights: så här räknar Meta själv.
//
// purchase, omni_purchase och offsite_conversion.fb_pixel_purchase är olika vyer
// av SAMMA köp. Meta redovisar köp som det största av dem — de ska inte summeras.
export const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
export const LANDING_PAGE_TYPES = ['omni_landing_page_view', 'landing_page_view'];

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));

export function actionValue(list, types) {
  return (list || [])
    .filter((a) => types.includes(a.action_type))
    .reduce((max, a) => Math.max(max, num(a.value)), 0);
}

export function canonicalInsight(row = {}) {
  const spend = num(row.spend);
  const impressions = Math.round(num(row.impressions));
  const clicks = Math.round(num(row.clicks));
  const purchases = actionValue(row.actions, PURCHASE_TYPES);
  const revenue = actionValue(row.action_values, PURCHASE_TYPES);
  return {
    spend,
    impressions,
    clicks,
    cpm: row.cpm !== undefined ? num(row.cpm) : impressions > 0 ? (spend / impressions) * 1000 : 0,
    conversions: purchases,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    link_clicks: actionValue(row.actions, ['link_click']),
    landing_page_views: actionValue(row.actions, LANDING_PAGE_TYPES),
  };
}

export const ZERO_INSIGHT = canonicalInsight({});
