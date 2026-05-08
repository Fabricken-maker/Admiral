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

  const token = process.env.META_ACCESS_TOKEN;

  // Accept optional ad_account_id to filter; otherwise fetch all accounts first
  const accountId = event.queryStringParameters?.ad_account_id;

  try {
    let accountIds = [];

    if (accountId) {
      accountIds = [accountId];
    } else {
      // Fetch all ad accounts
      const meRes = await fetch(
        `https://graph.facebook.com/v25.0/me/adaccounts?fields=id&limit=50&access_token=${token}`
      );
      const meData = await meRes.json();
      if (meData.error) throw new Error(meData.error.message);
      accountIds = (meData.data || []).map(a => a.id);
    }

    const allCampaigns = [];

    await Promise.all(accountIds.map(async (actId) => {
      const [campRes, insightRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v25.0/${actId}/campaigns?fields=id,name,status,objective&limit=20&access_token=${token}`),
        fetch(`https://graph.facebook.com/v25.0/${actId}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,actions,action_values&date_preset=last_30d&limit=20&access_token=${token}`)
      ]);

      const [campData, insightData] = await Promise.all([campRes.json(), insightRes.json()]);
      if (campData.error) return;

      const insightMap = {};
      for (const row of (insightData.data || [])) {
        const purchases = (row.actions || [])
          .filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))
          .reduce((s, a) => s + parseFloat(a.value || 0), 0);
        const revenue = (row.action_values || [])
          .filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))
          .reduce((s, a) => s + parseFloat(a.value || 0), 0);
        const spend = parseFloat(row.spend || 0);
        insightMap[row.campaign_id] = { spend, revenue, purchases, roas: spend > 0 ? revenue / spend : 0 };
      }

      for (const c of (campData.data || [])) {
        if (c.status === 'DELETED' || c.status === 'ARCHIVED') continue;
        const ins = insightMap[c.id] || { spend: 0, revenue: 0, purchases: 0, roas: 0 };
        allCampaigns.push({
          id: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective || '',
          ad_account_id: actId,
          spend: ins.spend,
          revenue: ins.revenue,
          conversions: ins.purchases,
          roas: ins.roas
        });
      }
    }));

    // Sort by spend desc
    allCampaigns.sort((a, b) => b.spend - a.spend);

    return { statusCode: 200, headers: cors, body: JSON.stringify({ campaigns: allCampaigns }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
