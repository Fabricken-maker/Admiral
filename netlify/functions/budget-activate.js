import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Auth
  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { campaign_id, campaign_name, ad_account_id, monthly_budget, currency = 'SEK' } = JSON.parse(event.body || '{}');

  if (!campaign_id || !ad_account_id || !monthly_budget) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'campaign_id, ad_account_id och monthly_budget krävs' }) };
  }

  const token = process.env.META_ACCESS_TOKEN;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.max(1, Math.ceil((monthEnd - now) / 86400000));
  const dailyBudgetSEK = monthly_budget / daysLeft;

  try {
    // 1. Fetch ad sets for campaign
    const adsetRes = await fetch(
      `https://graph.facebook.com/v25.0/${campaign_id}/adsets?fields=id,name,status&access_token=${token}`
    );
    const adsetData = await adsetRes.json();
    if (adsetData.error) throw new Error(adsetData.error.message);

    const activeAdsets = adsetData.data.filter(as => as.status !== 'DELETED');
    if (activeAdsets.length === 0) throw new Error('Inga aktiva ad sets hittades i kampanjen');

    // 2. Equal split to start — Admiral will rebalance daily based on ROAS
    const budgetPerAdset = Math.round((dailyBudgetSEK / activeAdsets.length) * 100); // in cents

    // 3. Set daily budget on each ad set via Meta API
    const metaUpdates = await Promise.all(
      activeAdsets.map(as =>
        fetch(`https://graph.facebook.com/v25.0/${as.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daily_budget: budgetPerAdset, access_token: token })
        }).then(r => r.json())
      )
    );

    const errors = metaUpdates.filter(r => r.error);
    if (errors.length > 0) throw new Error(`Meta API fel: ${errors[0].error.message}`);

    // 4. Save budget plan to Supabase
    const { data: plan, error: planErr } = await supabase
      .from('budget_plans')
      .insert({
        user_id: userId,
        campaign_id,
        campaign_name,
        ad_account_id,
        monthly_budget,
        currency,
        month_start: monthStart.toISOString().split('T')[0],
        month_end: monthEnd.toISOString().split('T')[0],
        status: 'active'
      })
      .select()
      .single();

    if (planErr) throw new Error(planErr.message);

    // 5. Save ad set allocations
    await supabase.from('ad_set_allocations').insert(
      activeAdsets.map(as => ({
        budget_plan_id: plan.id,
        ad_set_id: as.id,
        ad_set_name: as.name,
        daily_budget_cents: budgetPerAdset,
        allocation_pct: 100 / activeAdsets.length
      }))
    );

    // 6. Log first spend entry
    await supabase.from('spend_log').insert({
      budget_plan_id: plan.id,
      log_date: now.toISOString().split('T')[0],
      planned_spend: dailyBudgetSEK,
      actual_spend: 0,
      pacing_ratio: 0
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        plan_id: plan.id,
        daily_budget_sek: dailyBudgetSEK.toFixed(2),
        adsets_updated: activeAdsets.length,
        budget_per_adset_sek: (budgetPerAdset / 100).toFixed(2),
        days_left_in_month: daysLeft
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
