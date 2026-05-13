import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = 'admin@admiralai.se';

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userEmail;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userEmail = decoded.email;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  if (userEmail !== ADMIN_EMAIL) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Hämta alla kunder med token-status och aktiva budgetplaner
  const { data: users } = await supabase
    .from('users')
    .select('id, email, name, created_at')
    .neq('email', ADMIN_EMAIL)
    .order('created_at', { ascending: false });

  const customers = await Promise.all((users || []).map(async (u) => {
    const [tokenRes, plansRes] = await Promise.all([
      supabase.from('meta_tokens').select('expires_at').eq('user_id', u.id).single(),
      supabase.from('budget_plans').select('id, campaign_name, monthly_budget, total_spent, status').eq('user_id', u.id)
    ]);

    const token = tokenRes.data;
    const plans = plansRes.data || [];

    const expiresAt = token?.expires_at ? new Date(token.expires_at) : null;
    const daysLeft = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      created_at: u.created_at,
      meta_connected: !!token,
      token_days_left: daysLeft,
      token_expired: daysLeft !== null && daysLeft <= 0,
      active_plans: plans.filter(p => p.status === 'active').length,
      total_budget: plans.filter(p => p.status === 'active').reduce((s, p) => s + parseFloat(p.monthly_budget || 0), 0),
      total_spent: plans.filter(p => p.status === 'active').reduce((s, p) => s + parseFloat(p.total_spent || 0), 0),
      plans
    };
  }));

  return { statusCode: 200, headers: cors, body: JSON.stringify({ customers }) };
};
