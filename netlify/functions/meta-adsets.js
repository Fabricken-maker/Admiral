import jwt from 'jsonwebtoken';

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  try { jwt.verify(auth, process.env.JWT_SECRET); }
  catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  const campaignId = event.queryStringParameters?.campaign_id;
  if (!campaignId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'campaign_id required' }) };

  const token = process.env.META_ACCESS_TOKEN;

  try {
    // Fetch ad sets with spend insight (last 30d)
    const [adsetRes, insightRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v25.0/${campaignId}/adsets?fields=id,name,status,daily_budget,lifetime_budget,bid_amount&access_token=${token}`),
      fetch(`https://graph.facebook.com/v25.0/${campaignId}/insights?level=adset&fields=adset_id,adset_name,spend,impressions,clicks,cpm,actions,action_values&date_preset=last_30d&access_token=${token}`)
    ]);

    const [adsetData, insightData] = await Promise.all([adsetRes.json(), insightRes.json()]);

    if (adsetData.error) throw new Error(adsetData.error.message);

    // Map insights to ad sets
    const insightMap = {};
    for (const row of (insightData.data || [])) {
      const purchases = (row.actions || [])
        .filter(a => ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase'].includes(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
      const revenue = (row.action_values || [])
        .filter(a => ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase'].includes(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
      const spend = parseFloat(row.spend || 0);
      insightMap[row.adset_id] = {
        spend,
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        cpm: parseFloat(row.cpm || 0),
        conversions: purchases,
        roas: spend > 0 ? revenue / spend : 0
      };
    }

    const adsets = adsetData.data.map(as => ({
      id: as.id,
      name: as.name,
      status: as.status,
      daily_budget_sek: as.daily_budget ? parseInt(as.daily_budget) / 100 : null,
      ...( insightMap[as.id] || { spend: 0, impressions: 0, clicks: 0, cpm: 0, conversions: 0, roas: 0 })
    }));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ adsets }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
