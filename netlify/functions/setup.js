import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

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

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Missing token' }) };
    }

    const decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
    const body = JSON.parse(event.body);

    const { error } = await supabase
      .from('users')
      .update({
        setup_completed: true,
        meta_access_token: body.access_token,
        meta_ad_account_id: body.ad_account_id,
        meta_ad_account_id_2: body.ad_account_id_2 || null,
        meta_ad_account_id_3: body.ad_account_id_3 || null,
        meta_business_manager_id: body.business_manager_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', decoded.id);

    if (error) {
      console.error('Setup update error:', error);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    }

    const newToken = jwt.sign(
      { id: decoded.id, email: decoded.email, subscription_tier: decoded.subscription_tier, setup_completed: true },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ message: 'Setup complete', token: newToken, redirect: '/dashboard-welcome.html' })
    };
  } catch (err) {
    console.error('Setup error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
