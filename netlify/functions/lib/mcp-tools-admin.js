/**
 * Admiral MCP — Admin-verktyg (full åtkomst)
 * Exponerar alla kunder, budgetar, hälsorapporter och fakturaunderlag
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const adminToolDefinitions = [
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

    default:
      throw new Error(`Okänt verktyg: ${name}`);
  }
}
