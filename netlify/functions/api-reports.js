import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  try { jwt.verify(auth, process.env.JWT_SECRET); }
  catch { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('health_reports')
    .select('*')
    .eq('report_date', today)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };

  return { statusCode: 200, headers: cors, body: JSON.stringify({ date: today, reports: data || [] }) };
};
