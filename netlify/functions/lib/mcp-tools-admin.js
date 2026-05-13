/**
 * Admiral MCP — Admin-verktyg (full åtkomst)
 * Exponerar alla kunder, budgetar, hälsorapporter och fakturaunderlag
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const adminToolDefinitions = [
  {
    name: 'get_spend_trends',
    description: 'Spend-trend per dag för alla eller en specifik kund. Bra för att se avvikelser och säsongsvariationer.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id:  { type: 'number', description: 'Filtrera på specifik kund (optional)' },
        days:     { type: 'number', description: 'Antal dagar bakåt (default: 30)' }
      }
    }
  },
  {
    name: 'get_token_status_all',
    description: 'Snabb översikt av Meta-tokenstatus för alla kunder. Visar vilka som snart löper ut.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_customer_activity',
    description: 'Inloggningshistorik och aktivitet för en kund. Använd för att bedöma churn-risk.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'number', description: 'Kundens user ID' }
      }
    }
  },
  {
    name: 'get_all_customers',
    description: 'Hämtar alla kunder med status, Meta-koppling, aktiva budgetar och total månadsbudget.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'terminated', 'all'], description: 'Filtrera på kontostatus (default: all)' }
      }
    }
  },
  {
    name: 'get_customer_detail',
    description: 'Hämtar fullständig information om en specifik kund inklusive kampanjer, budgetplaner och senaste hälsorapport.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id:    { type: 'number', description: 'Kundens user ID' },
        email:      { type: 'string', description: 'Kundens e-postadress (alternativ till user_id)' }
      }
    }
  },
  {
    name: 'get_inactive_accounts',
    description: 'Returnerar kunder som inte loggat in på X dagar. Används för att trigga uppföljning i CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Antal dagar utan inloggning (default: 30)' }
      }
    }
  },
  {
    name: 'get_health_reports',
    description: 'Hämtar hälsorapporter för alla eller en specifik kund. Filtrerbara på allvarlighetsgrad och datum.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id:   { type: 'number',  description: 'Filtrera på specifik kund (optional)' },
        severity:  { type: 'string',  enum: ['critical', 'warning', 'info', 'all'], description: 'Filtrera på allvarlighetsgrad (default: all)' },
        date:      { type: 'string',  description: 'Datum YYYY-MM-DD (default: idag)' },
        days_back: { type: 'number',  description: 'Hämta rapporter X dagar bakåt (default: 1)' }
      }
    }
  },
  {
    name: 'get_invoice_basis',
    description: 'Hämtar fakturaunderlag per kund för en given månad. Inkluderar kampanjnamn, månadsbudget och faktisk spend.',
    inputSchema: {
      type: 'object',
      properties: {
        month:   { type: 'string', description: 'Format YYYY-MM (default: nuvarande månad)' },
        user_id: { type: 'number', description: 'Filtrera på specifik kund (optional)' }
      }
    }
  },
  {
    name: 'get_budget_overview',
    description: 'Översikt av alla aktiva budgetar: total ARR, aktiva planer, total spend och pacing.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_fortnox_invoice',
    description: 'Skapar fakturor i Fortnox för en given månad. Stöder dry_run för att förhandsgranska utan att skapa.',
    inputSchema: {
      type: 'object',
      properties: {
        month:   { type: 'string', description: 'Format YYYY-MM (default: nuvarande månad)' },
        user_id: { type: 'number', description: 'Fakturera endast en specifik kund (optional)' },
        dry_run: { type: 'boolean', description: 'true = förhandsgranska utan att skapa faktura (default: false)' }
      }
    }
  },
  {
    name: 'set_account_status',
    description: 'Aktivera, pausa eller avsluta ett kundkonto. Samma åtgärder som i admin-panelen.',
    inputSchema: {
      type: 'object',
      required: ['user_id', 'action'],
      properties: {
        user_id: { type: 'number', description: 'Kundens user ID' },
        action:  { type: 'string', enum: ['activate', 'pause', 'terminate'], description: 'Åtgärd att utföra' },
        reason:  { type: 'string', description: 'Anledning (visas i admin-loggen)' }
      }
    }
  }
];

export async function callAdminTool(name, args = {}) {
  switch (name) {

    case 'get_all_customers': {
      let query = supabase
        .from('users')
        .select(`
          id, email, name, company_name, status, created_at, last_login_at,
          meta_tokens(expires_at),
          budget_plans(id, monthly_budget, status, campaign_name)
        `)
        .order('created_at', { ascending: false });

      if (args.status && args.status !== 'all') {
        query = query.eq('status', args.status);
      }

      const { data, error } = await query;
      if (error) throw error;

      const customers = (data || []).map(u => {
        const token = u.meta_tokens?.[0];
        const activePlans = (u.budget_plans || []).filter(p => p.status === 'active');
        const totalBudget = activePlans.reduce((s, p) => s + (p.monthly_budget || 0), 0);
        const daysLeft = token?.expires_at
          ? Math.ceil((new Date(token.expires_at) - Date.now()) / 86400000)
          : null;
        return {
          id: u.id,
          email: u.email,
          name: u.name || u.company_name || '—',
          status: u.status || 'active',
          meta_connected: !!token,
          token_days_left: daysLeft,
          active_plans: activePlans.length,
          monthly_budget_sek: Math.round(totalBudget),
          last_login_at: u.last_login_at,
          registered_at: u.created_at
        };
      });

      return { customers, count: customers.length };
    }

    case 'get_customer_detail': {
      let query = supabase
        .from('users')
        .select(`
          id, email, name, company_name, status, created_at, last_login_at,
          meta_tokens(expires_at, meta_user_id),
          budget_plans(id, campaign_name, campaign_id, monthly_budget, total_spent, status, month_start, month_end,
            ad_set_allocations(ad_set_id, daily_budget_cents, last_roas, allocation_pct))
        `);

      if (args.user_id)  query = query.eq('id', args.user_id);
      else if (args.email) query = query.eq('email', args.email);
      else throw new Error('Ange user_id eller email');

      const { data, error } = await query.single();
      if (error) throw error;

      // Senaste hälsorapport
      const { data: health } = await supabase
        .from('health_reports')
        .select('severity, category, message, report_date')
        .eq('user_id', data.id)
        .order('report_date', { ascending: false })
        .limit(10);

      return { customer: data, recent_health: health || [] };
    }

    case 'get_inactive_accounts': {
      const days = args.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();

      const { data, error } = await supabase
        .from('users')
        .select('id, email, name, company_name, status, last_login_at, created_at')
        .eq('status', 'active')
        .or(`last_login_at.lt.${cutoff},last_login_at.is.null`);

      if (error) throw error;

      const accounts = (data || []).map(u => ({
        id: u.id,
        email: u.email,
        name: u.name || u.company_name || '—',
        days_inactive: u.last_login_at
          ? Math.floor((Date.now() - new Date(u.last_login_at)) / 86400000)
          : null,
        last_login_at: u.last_login_at,
        registered_at: u.created_at
      }));

      return { accounts, count: accounts.length, threshold_days: days };
    }

    case 'get_health_reports': {
      const today = new Date().toISOString().split('T')[0];
      const daysBack = args.days_back ?? 1;
      const fromDate = new Date(Date.now() - (daysBack - 1) * 86400000).toISOString().split('T')[0];
      const targetDate = args.date || today;

      let query = supabase
        .from('health_reports')
        .select('id, user_id, report_date, severity, category, message, details')
        .gte('report_date', daysBack > 1 ? fromDate : targetDate)
        .lte('report_date', targetDate)
        .order('report_date', { ascending: false })
        .order('severity', { ascending: true });

      if (args.user_id) query = query.eq('user_id', args.user_id);
      if (args.severity && args.severity !== 'all') query = query.eq('severity', args.severity);

      const { data, error } = await query;
      if (error) throw error;

      const counts = { critical: 0, warning: 0, info: 0 };
      (data || []).forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });

      return { reports: data || [], summary: counts };
    }

    case 'get_invoice_basis': {
      const now = new Date();
      const month = args.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthStart = `${month}-01`;
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      let query = supabase
        .from('budget_plans')
        .select(`
          id, campaign_name, monthly_budget, total_spent, status,
          month_start, month_end,
          users(id, email, name, company_name)
        `)
        .lte('month_start', monthEnd)
        .gte('month_end', monthStart);

      if (args.user_id) query = query.eq('user_id', args.user_id);

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data || []).map(p => ({
        customer_id:   p.users?.id,
        customer_email: p.users?.email,
        customer_name:  p.users?.name || p.users?.company_name || '—',
        campaign_name:  p.campaign_name,
        monthly_budget: Math.round(p.monthly_budget || 0),
        actual_spend:   Math.round(p.total_spent || 0),
        status:         p.status,
        period:         `${p.month_start} – ${p.month_end}`
      }));

      const total = rows.reduce((s, r) => s + r.monthly_budget, 0);
      return { month, rows, total_invoiceable_sek: Math.round(total), count: rows.length };
    }

    case 'get_budget_overview': {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('budget_plans')
        .select('id, monthly_budget, total_spent, status, user_id')
        .lte('month_start', today)
        .gte('month_end', today);

      if (error) throw error;

      const active = (data || []).filter(p => p.status === 'active');
      const totalBudget = active.reduce((s, p) => s + (p.monthly_budget || 0), 0);
      const totalSpent  = active.reduce((s, p) => s + (p.total_spent  || 0), 0);
      const uniqueCustomers = new Set(active.map(p => p.user_id)).size;

      return {
        active_plans:        active.length,
        unique_customers:    uniqueCustomers,
        total_monthly_budget_sek: Math.round(totalBudget),
        total_spent_sek:     Math.round(totalSpent),
        pacing_pct:          totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0
      };
    }

    case 'set_account_status': {
      const { user_id, action, reason } = args;
      if (!user_id || !action) throw new Error('user_id och action krävs');

      const statusMap = { activate: 'active', pause: 'paused', terminate: 'terminated' };
      const newStatus = statusMap[action];
      if (!newStatus) throw new Error('Ogiltig action');

      const updateData = {
        status: newStatus,
        ...(action === 'pause'     ? { paused_at: new Date().toISOString(), paused_reason: reason || 'Via MCP' } : {}),
        ...(action === 'terminate' ? { paused_at: new Date().toISOString(), paused_reason: reason || 'Via MCP' } : {}),
        ...(action === 'activate'  ? { paused_at: null, paused_reason: null } : {})
      };

      const { error: userErr } = await supabase.from('users').update(updateData).eq('id', user_id);
      if (userErr) throw userErr;

      if (action === 'pause') {
        await supabase.from('budget_plans').update({ status: 'paused' }).eq('user_id', user_id).eq('status', 'active');
      } else if (action === 'activate') {
        await supabase.from('budget_plans').update({ status: 'active' }).eq('user_id', user_id).eq('status', 'paused');
      } else if (action === 'terminate') {
        await supabase.from('budget_plans').update({ status: 'completed' }).eq('user_id', user_id).in('status', ['active', 'paused']);
      }

      return { success: true, user_id, action, new_status: newStatus };
    }

    case 'create_fortnox_invoice': {
      // Delegerar till fortnox-invoice function via intern fetch
      const baseUrl = process.env.BASE_URL || 'https://admiralai.se';
      const res = await fetch(`${baseUrl}/api/fortnox/invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Använder service-till-service autentisering via intern nyckel
          'X-Internal-Service': process.env.INTERNAL_SERVICE_SECRET || 'admiral-internal'
        },
        body: JSON.stringify({
          month:   args.month,
          user_id: args.user_id,
          dry_run: args.dry_run ?? false
        })
      });
      return await res.json();
    }

    case 'get_spend_trends': {
      const days = args.days ?? 30;
      const fromDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];

      let query = supabase
        .from('spend_log')
        .select(`
          log_date, actual_spend, planned_spend, pacing_ratio,
          budget_plans(campaign_name, user_id, users(email, name, company_name))
        `)
        .gte('log_date', fromDate)
        .order('log_date', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      // Filtrera på user_id om angivet
      const rows = (data || []).filter(r =>
        !args.user_id || r.budget_plans?.user_id === args.user_id
      );

      // Aggregera per dag
      const byDate = {};
      for (const r of rows) {
        const date = r.log_date;
        if (!byDate[date]) byDate[date] = { date, total_spend: 0, total_planned: 0, campaigns: [] };
        byDate[date].total_spend   += parseFloat(r.actual_spend  || 0);
        byDate[date].total_planned += parseFloat(r.planned_spend || 0);
        byDate[date].campaigns.push({
          campaign:     r.budget_plans?.campaign_name,
          customer:     r.budget_plans?.users?.name || r.budget_plans?.users?.company_name || r.budget_plans?.users?.email,
          spend:        Math.round(parseFloat(r.actual_spend || 0)),
          pacing_pct:   r.pacing_ratio ? Math.round(r.pacing_ratio * 100) : null
        });
      }

      const trend = Object.values(byDate).map(d => ({
        ...d,
        total_spend:   Math.round(d.total_spend),
        total_planned: Math.round(d.total_planned)
      }));

      return { trend, period_days: days, data_points: trend.length };
    }

    case 'get_token_status_all': {
      const { data, error } = await supabase
        .from('meta_tokens')
        .select('user_id, expires_at, users(email, name, company_name, status)')
        .order('expires_at', { ascending: true });

      if (error) throw error;

      const statuses = (data || []).map(t => {
        const daysLeft = t.expires_at
          ? Math.ceil((new Date(t.expires_at) - Date.now()) / 86400000)
          : null;
        return {
          user_id:      t.user_id,
          email:        t.users?.email,
          name:         t.users?.name || t.users?.company_name || '—',
          account_status: t.users?.status || 'active',
          expires_at:   t.expires_at,
          days_left:    daysLeft,
          health:       daysLeft === null ? 'unknown'
                      : daysLeft <= 0    ? 'expired'
                      : daysLeft <= 3    ? 'critical'
                      : daysLeft <= 7    ? 'warning'
                      : 'ok'
        };
      });

      const summary = {
        ok:       statuses.filter(s => s.health === 'ok').length,
        warning:  statuses.filter(s => s.health === 'warning').length,
        critical: statuses.filter(s => s.health === 'critical').length,
        expired:  statuses.filter(s => s.health === 'expired').length
      };

      return { tokens: statuses, summary };
    }

    case 'get_customer_activity': {
      const { user_id } = args;
      if (!user_id) throw new Error('user_id krävs');

      const { data: user, error } = await supabase
        .from('users')
        .select('id, email, name, company_name, status, created_at, last_login_at, paused_at, paused_reason')
        .eq('id', user_id)
        .single();

      if (error) throw error;

      const daysInactive = user.last_login_at
        ? Math.floor((Date.now() - new Date(user.last_login_at)) / 86400000)
        : null;
      const daysSinceRegistration = Math.floor((Date.now() - new Date(user.created_at)) / 86400000);

      // Hälsorapporter senaste 30 dagarna
      const { data: health } = await supabase
        .from('health_reports')
        .select('report_date, severity, category, message')
        .eq('user_id', user_id)
        .gte('report_date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0])
        .order('report_date', { ascending: false });

      // Budgetplaner
      const { data: plans } = await supabase
        .from('budget_plans')
        .select('campaign_name, monthly_budget, total_spent, status, month_start, month_end')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(5);

      const churnRisk = daysInactive === null ? 'unknown'
                      : daysInactive > 90 ? 'high'
                      : daysInactive > 30 ? 'medium'
                      : 'low';

      return {
        user: {
          id: user.id, email: user.email,
          name: user.name || user.company_name || '—',
          status: user.status,
          registered_at: user.created_at,
          days_since_registration: daysSinceRegistration,
          last_login_at: user.last_login_at,
          days_inactive: daysInactive,
          churn_risk: churnRisk,
          paused_at: user.paused_at,
          paused_reason: user.paused_reason
        },
        recent_budgets: plans || [],
        health_last_30d: {
          critical: (health || []).filter(h => h.severity === 'critical').length,
          warning:  (health || []).filter(h => h.severity === 'warning').length,
          reports:  (health || []).slice(0, 5)
        }
      };
    }

    default:
      throw new Error(`Okänt verktyg: ${name}`);
  }
}
