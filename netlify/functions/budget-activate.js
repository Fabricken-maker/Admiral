import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { tokensForCustomer } from './lib/token-store.js';
import { graphGet, withTokens } from './lib/meta-graph.js';
import { createRepo } from './lib/write-repo.js';
import { buildProposal, ProposalRejected } from './lib/build-proposal.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'POST, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Auth
  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId, isAdmin;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
    isAdmin = decoded.email === (process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se');
  } catch {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  // Kunder kan inte skapa egna åtgärder: budgetplaner läggs upp av Fabricken och blir förslag.
  if (!isAdmin) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Budgetplaner läggs upp av Fabricken. Ändringar i Meta godkänner du under Förslag.' }) };

  const { campaign_id, campaign_name, ad_account_id, monthly_budget, currency = 'SEK', user_id } = JSON.parse(event.body || '{}');
  // Kunden är den vars skrivbara konton innehåller kontot (annars Fabricken själv).
  let customerId = Number(user_id || 0);
  if (!customerId) {
    const { data: owner } = await supabase.from('write_settings').select('user_id').contains('ad_account_ids', [ad_account_id]).limit(1);
    customerId = owner?.[0]?.user_id || userId;
  }

  if (!campaign_id || !ad_account_id || !monthly_budget) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'campaign_id, ad_account_id och monthly_budget krävs' }) };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.max(1, Math.ceil((monthEnd - now) / 86400000));
  const dailyBudgetSEK = monthly_budget / daysLeft;
  const tokens = await tokensForCustomer(supabase, customerId);

  try {
    // 1. Hämta kampanjens ad sets (endast läsning)
    const adsetData = await withTokens(tokens, (t) => graphGet(`${campaign_id}/adsets`, { fields: 'id,name,status' }, t));
    const activeAdsets = (adsetData.data || []).filter(as => as.status !== 'DELETED');
    if (activeAdsets.length === 0) throw new Error('Inga aktiva ad sets hittades i kampanjen');

    // 2. Lika fördelning till att börja med — Admiral föreslår ombalansering dagligen utifrån ROAS
    const budgetPerAdset = Math.round((dailyBudgetSEK / activeAdsets.length) * 100); // i öre

    // 3. Modul D: inga skrivningar här. Varje budget blir ett förslag som kunden godkänner.
    const repo = createRepo(supabase);
    const proposals = [];
    for (const as of activeAdsets) {
      try {
        const p = await buildProposal({
          supabase, repo, tokens,
          spec: { userId: customerId, type: 'budget_change', objectType: 'adset', objectId: as.id, dailyBudgetSek: budgetPerAdset / 100, source: 'budget_activate', createdBy: userId },
        });
        proposals.push({ ad_set_id: as.id, proposal_id: p.id });
      } catch (e) {
        if (!(e instanceof ProposalRejected)) throw e;
        proposals.push({ ad_set_id: as.id, rejected: e.message });
      }
    }

    // 4. Save budget plan to Supabase
    const { data: plan, error: planErr } = await supabase
      .from('budget_plans')
      .insert({
        user_id: customerId,
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
        proposals,
        budget_per_adset_sek: (budgetPerAdset / 100).toFixed(2),
        days_left_in_month: daysLeft
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

export default modern(handler);
