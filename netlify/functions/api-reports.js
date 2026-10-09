import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async (event) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  let userId;
  try {
    const decoded = jwt.verify(auth, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('health_reports')
    .select('*')
    .eq('report_date', today)
    .eq('user_id', userId)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };

  return { statusCode: 200, headers: cors, body: JSON.stringify({ date: today, reports: data || [] }) };
};

export default modern(handler);
