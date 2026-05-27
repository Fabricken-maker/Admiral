/**
 * Admiral — GA4 Insights
 * GET /api/ga4/insights?budget_plan_id=X&days=30
 * Hämtar sessions + boka-klick från Google Analytics 4 Data API.
 * Kräver env vars: GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_JSON (base64)
 * Valfri: GA4_BOKA_EVENT (default: boka_click)
 */
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = (event) => getCorsHeaders(event, 'GET, OPTIONS');

// Hämta Google access token via service account JWT
async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now
  };
  const signed = jwt.sign(claim, sa.private_key, { algorithm: 'RS256' });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signed
    })
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('GA4 auth misslyckades: ' + JSON.stringify(d));
  return d.access_token;
}

// Kör GA4 rapport
async function runGA4Report(propertyId, accessToken, days, bokaEvent) {
  const body = {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions:  [{ name: 'date' }],
    metrics:     [{ name: 'sessions' }, { name: 'eventCount' }],
    dimensionFilter: {
      orGroup: {
        expressions: [
          { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'facebook' } } },
          { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'instagram' } } },
          { filter: { fieldName: 'sessionMedium', stringFilter: { matchType: 'CONTAINS', value: 'cpc' } } }
        ]
      }
    }
  };

  // Separat rapport för boka-klick (specifikt event)
  const bokaBody = {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions:  [{ name: 'date' }],
    metrics:     [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: bokaEvent } } },
          {
            orGroup: {
              expressions: [
                { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'facebook' } } },
                { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'instagram' } } }
              ]
            }
          }
        ]
      }
    }
  };

  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const [sessRes, bokaRes] = await Promise.all([
    fetch(base, { method: 'POST', headers, body: JSON.stringify(body) }),
    fetch(base, { method: 'POST', headers, body: JSON.stringify(bokaBody) })
  ]);

  const [sessData, bokaData] = await Promise.all([sessRes.json(), bokaRes.json()]);

  // Bygg dagsvis map
  const sessMap = {};
  for (const row of (sessData.rows || [])) {
    const date = row.dimensionValues[0].value; // YYYYMMDD
    const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
    sessMap[d] = parseInt(row.metricValues[0].value || 0);
  }

  const bokaMap = {};
  for (const row of (bokaData.rows || [])) {
    const date = row.dimensionValues[0].value;
    const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
    bokaMap[d] = parseInt(row.metricValues[0].value || 0);
  }

  // Slå ihop
  const allDates = new Set([...Object.keys(sessMap), ...Object.keys(bokaMap)]);
  return [...allDates].sort().map(d => ({
    date:        d,
    sessions:    sessMap[d] || 0,
    boka_clicks: bokaMap[d] || 0
  }));
}

export const handler = async (event) => {
  const cors = CORS(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  // Auth
  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    userId  = p.id;
    isAdmin = p.email === 'admin@admiralai.se';
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Kolla att GA4 är konfigurerat
  if (!process.env.GA4_PROPERTY_ID || !process.env.GA4_SERVICE_ACCOUNT_JSON) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ not_configured: true, daily: [], totals: { sessions: 0, boka_clicks: 0 } })
    };
  }

  const budgetPlanId = event.queryStringParameters?.budget_plan_id;
  const days = parseInt(event.queryStringParameters?.days || '30');
  const bokaEvent = process.env.GA4_BOKA_EVENT || 'boka_click';

  // Verifiera att användaren har tillgång till denna budget_plan
  if (budgetPlanId && !isAdmin) {
    const { data } = await supabase.from('budget_plans').select('id').eq('id', budgetPlanId).eq('user_id', userId).single();
    if (!data) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Åtkomst nekad' }) };
  }

  try {
    const saJson = Buffer.from(process.env.GA4_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
    const sa = JSON.parse(saJson);
    const accessToken = await getGoogleToken(sa);
    const daily = await runGA4Report(process.env.GA4_PROPERTY_ID, accessToken, days, bokaEvent);

    // Cacha i Supabase om budget_plan_id angivet
    if (budgetPlanId && daily.length) {
      const upserts = daily.map(d => ({
        budget_plan_id: parseInt(budgetPlanId),
        metric_date:    d.date,
        sessions:       d.sessions,
        boka_clicks:    d.boka_clicks
      }));
      await supabase.from('ga4_metrics').upsert(upserts, { onConflict: 'budget_plan_id,metric_date' });
    }

    const totals = {
      sessions:    daily.reduce((s, d) => s + d.sessions, 0),
      boka_clicks: daily.reduce((s, d) => s + d.boka_clicks, 0)
    };

    return { statusCode: 200, headers: cors, body: JSON.stringify({ daily, totals, boka_event: bokaEvent }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
