import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getMetaToken } from './lib/get-meta-token.js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId  = decoded.id;
    isAdmin = decoded.email === 'admin@admiralai.se';
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  let token;
  try {
    token = await getMetaToken(userId);
  } catch (err) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: err.message, meta_not_connected: true }) };
  }

  // Bestäm vilka ad accounts som är tillåtna för denna användare
  let accountIds = [];
  const requestedId = event.queryStringParameters?.ad_account_id;

  if (requestedId) {
    // Explicit konto angivet — tillåt bara om admin eller om kontot finns i användarens budget_plans
    if (isAdmin) {
      accountIds = [requestedId];
    } else {
      const { data: plans } = await supabase
        .from('budget_plans')
        .select('ad_account_id')
        .eq('user_id', userId)
        .eq('ad_account_id', requestedId)
        .limit(1);
      accountIds = plans?.length ? [requestedId] : [];
    }
  } else if (isAdmin) {
    // Admin utan filter — hämta alla konton från Meta
    const meRes = await fetch(`https://graph.facebook.com/v25.0/me/adaccounts?fields=id&limit=50&access_token=${token}`);
    const meData = await meRes.json();
    if (meData.error) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: meData.error.message }) };
    accountIds = (meData.data || []).map(a => a.id);
  } else {
    // Kund utan filter — visa bara konton kopplade till deras budget_plans
    const { data: plans } = await supabase
      .from('budget_plans')
      .select('ad_account_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    accountIds = [...new Set((plans || []).map(p => p.ad_account_id).filter(Boolean))];
  }

  if (!accountIds.length) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ campaigns: [] }) };
  }

  // Wrapper med timeout för Meta-anrop — undviker att en hängande request blockerar hela funktionen
  const META_TIMEOUT_MS = 15000;
  const fetchWithTimeout = (url, ms = META_TIMEOUT_MS) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  };

  try {
    const allCampaigns = [];

    await Promise.all(accountIds.map(async (actId) => {
      let campRes, insightRes;
      try {
        [campRes, insightRes] = await Promise.all([
          fetchWithTimeout(`https://graph.facebook.com/v25.0/${actId}/campaigns?fields=id,name,status,objective&limit=20&access_token=${token}`),
          fetchWithTimeout(`https://graph.facebook.com/v25.0/${actId}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,actions,action_values&date_preset=last_30d&limit=20&access_token=${token}`)
        ]);
      } catch (e) {
        // Timeout/network-fel: hoppa över detta konto, fortsätt med övriga
        return;
      }

      const [campData, insightData] = await Promise.all([campRes.json(), insightRes.json()]);
      if (campData.error) return;

      const insightMap = {};
      for (const row of (insightData.data || [])) {
        const purchases = (row.actions || [])
          .filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))
          .reduce((s, a) => s + parseFloat(a.value || 0), 0);
        const linkClicks = (row.actions || [])
          .filter(a => a.action_type === 'link_click')
          .reduce((s, a) => s + parseFloat(a.value || 0), 0);
        const landingPageViews = (row.actions || [])
          .filter(a => ['landing_page_view', 'omni_landing_page_view'].includes(a.action_type))
          .reduce((s, a) => Math.max(s, parseFloat(a.value || 0)), 0);
        const revenue = (row.action_values || [])
          .filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))
          .reduce((s, a) => s + parseFloat(a.value || 0), 0);
        const spend       = parseFloat(row.spend || 0);
        const clicks      = parseInt(row.clicks || 0);
        const impressions = parseInt(row.impressions || 0);
        insightMap[row.campaign_id] = {
          spend, revenue, purchases, clicks, impressions, link_clicks: linkClicks, landing_page_views: landingPageViews,
          roas: spend > 0 ? revenue / spend : 0
        };
      }

      for (const c of (campData.data || [])) {
        if (c.status === 'DELETED' || c.status === 'ARCHIVED') continue;
        const ins = insightMap[c.id] || { spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, link_clicks: 0, landing_page_views: 0, roas: 0 };
        allCampaigns.push({
          id: c.id, name: c.name, status: c.status,
          objective: c.objective || '', ad_account_id: actId,
          spend: ins.spend, revenue: ins.revenue,
          conversions: ins.purchases, clicks: ins.clicks, roas: ins.roas,
          impressions: ins.impressions,
          link_clicks: ins.link_clicks,
          landing_page_views: ins.landing_page_views
        });
      }
    }));

    allCampaigns.sort((a, b) => b.spend - a.spend);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ campaigns: allCampaigns }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

export default modern(handler);
