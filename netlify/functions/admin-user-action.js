import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = 'admin@admiralai.se';

export const handler = async (event) => {
  const cors = getCorsHeaders(event, 'POST, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let adminEmail;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    adminEmail = decoded.email;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  if (adminEmail !== ADMIN_EMAIL) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const { user_id, action, reason } = JSON.parse(event.body || '{}');
  if (!user_id || !['pause', 'activate', 'terminate'].includes(action)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'user_id och action (pause|activate|terminate) krävs' }) };
  }

  try {
    const now = new Date().toISOString();

    if (action === 'pause') {
      await supabase.from('users').update({
        status: 'paused',
        paused_at: now,
        paused_reason: reason || 'Pausad av admin'
      }).eq('id', user_id);

      // Pausa alla aktiva budgetplaner
      await supabase.from('budget_plans')
        .update({ status: 'paused' })
        .eq('user_id', user_id)
        .eq('status', 'active');

    } else if (action === 'activate') {
      await supabase.from('users').update({
        status: 'active',
        paused_at: null,
        paused_reason: null
      }).eq('id', user_id);

      // Återaktivera pausade budgetplaner
      await supabase.from('budget_plans')
        .update({ status: 'active' })
        .eq('user_id', user_id)
        .eq('status', 'paused');

    } else if (action === 'terminate') {
      await supabase.from('users').update({
        status: 'terminated',
        paused_at: now,
        paused_reason: reason || 'Avslutat konto'
      }).eq('id', user_id);

      // Avsluta alla budgetplaner
      await supabase.from('budget_plans')
        .update({ status: 'completed' })
        .eq('user_id', user_id)
        .in('status', ['active', 'paused']);
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action, user_id }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
