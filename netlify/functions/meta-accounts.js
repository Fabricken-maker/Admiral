import jwt from 'jsonwebtoken';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders };

  // Verify JWT
  const auth = event.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'META_ACCESS_TOKEN not configured' }) };
  }

  try {
    // Fetch ad accounts
    const accountsRes = await fetch(
      `https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,currency,account_status,spend_cap,amount_spent&access_token=${accessToken}`
    );
    const accountsData = await accountsRes.json();

    if (accountsData.error) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: accountsData.error.message }) };
    }

    // For each active account, fetch basic spend insight (last 30 days)
    const accounts = await Promise.all(
      accountsData.data.map(async (acc) => {
        try {
          const insightRes = await fetch(
            `https://graph.facebook.com/v25.0/${acc.id}/insights?fields=spend,impressions,clicks,cpm,actions&date_preset=last_30d&access_token=${accessToken}`
          );
          const insightData = await insightRes.json();
          const insight = insightData.data?.[0] || {};

          const conversions = (insight.actions || [])
            .filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))
            .reduce((sum, a) => sum + parseInt(a.value || 0), 0);

          return {
            id: acc.id,
            name: acc.name,
            currency: acc.currency,
            status: acc.account_status === 1 ? 'active' : 'inactive',
            spend: parseFloat(insight.spend || 0),
            impressions: parseInt(insight.impressions || 0),
            clicks: parseInt(insight.clicks || 0),
            cpm: parseFloat(insight.cpm || 0),
            conversions
          };
        } catch {
          return {
            id: acc.id,
            name: acc.name,
            currency: acc.currency,
            status: acc.account_status === 1 ? 'active' : 'inactive',
            spend: 0, impressions: 0, clicks: 0, cpm: 0, conversions: 0
          };
        }
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ accounts })
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
