/**
 * Admiral MCP — Kundverktyg (scoped till inloggad kunds user_id)
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const customerToolDefinitions = [
  {
    name: 'get_my_campaigns',
    description: 'Hämtar alla kampanjer och budgetplaner för det här kontot.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_my_spend',
    description: 'Hämtar faktisk spend och pacing för en given månad.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Format YYYY-MM (default: nuvarande månad)' }
      }
    }
  },
  {
    name: 'get_my_health_report',
    description: 'Hämtar hälsorapporter för det här kontot de senaste X dagarna.',
    inputSchema: {
      type: 'object',
      properties: {
        days_back: { type: 'number', description: 'Antal dagar bakåt (default: 7)' },
        severity:  { type: 'string', enum: ['critical', 'warning', 'info', 'all'], description: 'Filtrera på allvarlighetsgrad' }
      }
    }
  },
  {
    name: 'get_my_roas_trend',
    description: 'Hämtar ROAS-trend per annonsgrupp de senaste X dagarna.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Antal dagar (default: 30)' }
      }
    }
  }
];

export async function callCustomerTool(name, args = {}, userId) {
  if (!userId) throw new Error('userId saknas — autentiseringsfel');

  switch (name) {

    case 'get_my_campaigns': {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('budget_plans')
        .select(`
          id, campaign_name, campaign_id, monthly_budget, total_spent,
          status, month_start, month_end,
          ad_set_allocations(ad_set_id, daily_budget_cents, last_roas, allocation_pct, updated_at)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return {
        campaigns: (data || []).map(p => ({
          id:             p.id,
          name:           p.campaign_name,
          campaign_id:    p.campaign_id,
          monthly_budget: Math.round(p.monthly_budget || 0),
          spent_so_far:   Math.round(p.total_spent || 0),
          remaining:      Math.round((p.monthly_budget || 0) - (p.total_spent || 0)),
          status:         p.status,
          period:         `${p.month_start} – ${p.month_end}`,
          ad_sets:        (p.ad_set_allocations || []).map(a => ({
            id:            a.ad_set_id,
            daily_budget_sek: (a.daily_budget_cents || 0) / 100,
            allocation_pct: Math.round(a.allocation_pct || 0),
            last_roas:      a.last_roas ? parseFloat(a.last_roas.toFixed(2)) : null
          }))
        }))
      };
    }

    case 'get_my_spend': {
      const now = new Date();
      const month = args.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthStart = `${month}-01`;
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const { data: plans, error: pErr } = await supabase
        .from('budget_plans')
        .select('id, campaign_name, monthly_budget, total_spent, month_start, month_end')
        .eq('user_id', userId)
        .lte('month_start', monthEnd)
        .gte('month_end', monthStart);

      if (pErr) throw pErr;

      const spendRows = await Promise.all((plans || []).map(async plan => {
        const { data: logs } = await supabase
          .from('spend_log')
          .select('log_date, actual_spend, planned_spend, pacing_ratio')
          .eq('budget_plan_id', plan.id)
          .gte('log_date', monthStart)
          .lte('log_date', monthEnd)
          .order('log_date', { ascending: false });

        return {
          campaign:       plan.campaign_name,
          monthly_budget: Math.round(plan.monthly_budget || 0),
          spent:          Math.round(plan.total_spent || 0),
          remaining:      Math.round((plan.monthly_budget || 0) - (plan.total_spent || 0)),
          pacing_pct:     logs?.[0]?.pacing_ratio ? Math.round(logs[0].pacing_ratio * 100) : null,
          daily_logs:     (logs || []).slice(0, 7)
        };
      }));

      return { month, campaigns: spendRows };
    }

    case 'get_my_health_report': {
      const daysBack = args.days_back ?? 7;
      const fromDate = new Date(Date.now() - (daysBack - 1) * 86400000).toISOString().split('T')[0];

      let query = supabase
        .from('health_reports')
        .select('report_date, severity, category, message')
        .eq('user_id', userId)
        .gte('report_date', fromDate)
        .order('report_date', { ascending: false });

      if (args.severity && args.severity !== 'all') query = query.eq('severity', args.severity);

      const { data, error } = await query;
      if (error) throw error;

      const counts = { critical: 0, warning: 0, info: 0 };
      (data || []).forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });

      return { reports: data || [], summary: counts, period_days: daysBack };
    }

    case 'get_my_roas_trend': {
      const days = args.days ?? 30;
      const { data: plans } = await supabase
        .from('budget_plans')
        .select('id, campaign_name, ad_set_allocations(ad_set_id, last_roas, allocation_pct, updated_at)')
        .eq('user_id', userId)
        .eq('status', 'active');

      const trend = (plans || []).flatMap(plan =>
        (plan.ad_set_allocations || []).map(a => ({
          campaign:      plan.campaign_name,
          ad_set_id:     a.ad_set_id,
          roas:          a.last_roas ? parseFloat(a.last_roas.toFixed(2)) : null,
          allocation_pct: Math.round(a.allocation_pct || 0),
          last_updated:  a.updated_at
        }))
      );

      return { ad_sets: trend, period_days: days };
    }

    default:
      throw new Error(`Okänt verktyg: ${name}`);
  }
}
