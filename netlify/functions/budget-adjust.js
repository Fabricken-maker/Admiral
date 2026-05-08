/**
 * Admiral Budget Adjuster — körs dagligen via Netlify Scheduled Functions
 * Justerar ad set-budgetar baserat på ROAS + pacing mot månadsplan
 */
import { createClient } from '@supabase/supabase-js';
import { getMetaToken } from './lib/get-meta-token.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function withRetry(fn, label, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }
  await supabase.from('health_reports').insert({
    report_date: new Date().toISOString().split('T')[0],
    severity: 'critical',
    category: 'meta_api',
    message: `budget-adjust misslyckades efter ${maxAttempts} försök: ${label}`,
    details: { error: lastErr?.message }
  });
  throw lastErr;
}

export const handler = async () => {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();

  try {
    // Hämta alla aktiva budgetplaner för nuvarande månad
    const { data: plans, error } = await supabase
      .from('budget_plans')
      .select('*, ad_set_allocations(*), user_id')
      .eq('status', 'active')
      .lte('month_start', today)
      .gte('month_end', today);

    if (error) throw error;
    if (!plans?.length) return { statusCode: 200, body: 'Inga aktiva planer' };

    const results = [];

    for (const plan of plans) {
      try {
        // Hämta kundens egna Meta-token
        const token = await getMetaToken(plan.user_id);

        const monthEnd = new Date(plan.month_end);
        const daysLeft = Math.max(1, Math.ceil((monthEnd - now) / 86400000));

        // Hämta faktisk spend hittills via Meta insights
        const spendData = await withRetry(async () => {
          const r = await fetch(
            `https://graph.facebook.com/v25.0/${plan.campaign_id}/insights?fields=spend&date_preset=this_month&access_token=${token}`
          );
          const d = await r.json();
          if (d.error) throw new Error(d.error.message);
          return d;
        }, `spend fetch campaign ${plan.campaign_id}`);
        const totalSpentSEK = parseFloat(spendData.data?.[0]?.spend || 0);

        const budgetLeft = plan.monthly_budget - totalSpentSEK;
        const newDailyTotal = Math.max(0, budgetLeft / daysLeft);

        // Hämta ROAS per ad set för smart fördelning
        const adsetInsightData = await withRetry(async () => {
          const r = await fetch(
            `https://graph.facebook.com/v25.0/${plan.campaign_id}/insights?level=adset&fields=adset_id,spend,action_values&date_preset=last_7d&access_token=${token}`
          );
          const d = await r.json();
          if (d.error) throw new Error(d.error.message);
          return d;
        }, `adset insights campaign ${plan.campaign_id}`);

        // Bygg ROAS-map per ad set
        const roasMap = {};
        for (const row of (adsetInsightData.data || [])) {
          const spend = parseFloat(row.spend || 0);
          const revenue = (row.action_values || [])
            .filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))
            .reduce((s, a) => s + parseFloat(a.value || 0), 0);
          roasMap[row.adset_id] = spend > 0 ? revenue / spend : 1;
        }

        const allocs = plan.ad_set_allocations;
        const totalRoas = allocs.reduce((s, as) => s + (roasMap[as.ad_set_id] || 1), 0);

        // Fördela budget proportionellt mot ROAS — bättre ad sets får mer
        const updatedAllocs = allocs.map(as => {
          const roas = roasMap[as.ad_set_id] || 1;
          const weight = totalRoas > 0 ? roas / totalRoas : 1 / allocs.length;
          const newDailyBudgetCents = Math.round(newDailyTotal * weight * 100);
          return { ...as, new_daily_cents: newDailyBudgetCents, roas };
        });

        // Uppdatera Meta API för varje ad set (med retry)
        await Promise.all(
          updatedAllocs.map(as =>
            withRetry(async () => {
              const r = await fetch(`https://graph.facebook.com/v25.0/${as.ad_set_id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ daily_budget: as.new_daily_cents, access_token: token })
              });
              const d = await r.json();
              if (d.error) throw new Error(d.error.message);
              return d;
            }, `update adset ${as.ad_set_id}`)
          )
        );

        // Uppdatera allocations i Supabase
        await Promise.all(
          updatedAllocs.map(as =>
            supabase.from('ad_set_allocations').update({
              daily_budget_cents: as.new_daily_cents,
              allocation_pct: (as.roas / totalRoas) * 100,
              last_roas: as.roas,
              last_spend: totalSpentSEK / allocs.length,
              updated_at: new Date().toISOString()
            }).eq('id', as.id)
          )
        );

        // Beräkna planerad spend (linjärt)
        const monthStart = new Date(plan.month_start);
        const daysTotal = Math.ceil((new Date(plan.month_end) - monthStart) / 86400000);
        const daysElapsed = daysTotal - daysLeft;
        const plannedSpend = (plan.monthly_budget / daysTotal) * daysElapsed;
        const pacingRatio = plannedSpend > 0 ? totalSpentSEK / plannedSpend : 0;

        // Logga dagens spend
        await supabase.from('spend_log').upsert({
          budget_plan_id: plan.id,
          log_date: today,
          planned_spend: plannedSpend,
          actual_spend: totalSpentSEK,
          pacing_ratio: pacingRatio
        }, { onConflict: 'budget_plan_id,log_date' });

        // Uppdatera total_spent på planen
        await supabase.from('budget_plans').update({
          total_spent: totalSpentSEK,
          updated_at: new Date().toISOString()
        }).eq('id', plan.id);

        // Om månaden är slut — markera som completed
        if (daysLeft <= 0) {
          await supabase.from('budget_plans').update({ status: 'completed' }).eq('id', plan.id);
        }

        results.push({
          plan_id: plan.id,
          campaign: plan.campaign_name,
          spent: totalSpentSEK,
          budget_left: budgetLeft,
          new_daily_total: newDailyTotal,
          pacing_ratio: pacingRatio
        });
      } catch (planErr) {
        results.push({ plan_id: plan.id, error: planErr.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ adjusted: results.length, results, timestamp: new Date().toISOString() })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
