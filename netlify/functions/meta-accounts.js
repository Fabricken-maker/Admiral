import jwt from 'jsonwebtoken';
import { getMetaToken } from './lib/get-meta-token.js';
import { getCorsHeaders } from './lib/cors.js';

export const handler = async (event) => {
  const corsHeaders = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders };

  const auth = event.headers.authorization || '';
  let userId;
  try {
    const decoded = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
    userId = decoded.id;
  } catch {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let accessToken;
  try {
    accessToken = await getMetaToken(userId);
  } catch (err) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: err.message, meta_not_connected: true }) };
  }

  try {
    const accountsRes = await fetch(
      `https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,currency,account_status,spend_cap,amount_spent&access_token=${accessToken}`
    );
    const accountsData = await accountsRes.json();

    if (accountsData.error) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: accountsData.error.message }) };
    }

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
          return { id: acc.id, name: acc.name, currency: acc.currency, status: acc.account_status === 1 ? 'active' : 'inactive', spend: 0, impressions: 0, clicks: 0, cpm: 0, conversions: 0 };
        }
      })
    );

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ accounts }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
