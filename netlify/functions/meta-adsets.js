import jwt from 'jsonwebtoken';
import { getMetaToken } from './lib/get-meta-token.js';
import { getCorsHeaders } from './lib/cors.js';

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  let token;
  try {
    token = await getMetaToken(userId);
  } catch (err) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: err.message, meta_not_connected: true }) };
  }

  const campaignId = event.queryStringParameters?.campaign_id;
  if (!campaignId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'campaign_id required' }) };

  try {
    const [adsetRes, insightRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v25.0/${campaignId}/adsets?fields=id,name,status,daily_budget,lifetime_budget,bid_amount&access_token=${token}`),
      fetch(`https://graph.facebook.com/v25.0/${campaignId}/insights?level=adset&fields=adset_id,adset_name,spend,impressions,clicks,cpm,actions,action_values&date_preset=last_30d&access_token=${token}`)
    ]);

    const [adsetData, insightData] = await Promise.all([adsetRes.json(), insightRes.json()]);
    if (adsetData.error) throw new Error(adsetData.error.message);

    const insightMap = {};
    for (const row of (insightData.data || [])) {
      const purchases = (row.actions || [])
        .filter(a => ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase'].includes(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
      const revenue = (row.action_values || [])
        .filter(a => ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase'].includes(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
      const spend = parseFloat(row.spend || 0);
      insightMap[row.adset_id] = { spend, impressions: parseInt(row.impressions || 0), clicks: parseInt(row.clicks || 0), cpm: parseFloat(row.cpm || 0), conversions: purchases, roas: spend > 0 ? revenue / spend : 0 };
    }

    const adsets = adsetData.data.map(as => ({
      id: as.id, name: as.name, status: as.status,
      daily_budget_sek: as.daily_budget ? parseInt(as.daily_budget) / 100 : null,
      ...(insightMap[as.id] || { spend: 0, impressions: 0, clicks: 0, cpm: 0, conversions: 0, roas: 0 })
    }));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ adsets }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
