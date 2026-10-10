import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

// Uppgifterna läses från databasen, inte bara ur JWT:n. Pausade och avslutade konton stoppas
// redan i modern.js (lib/auth-guard.js).
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_EMAIL = process.env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se';

const handler = async (event, context) => {
  const cors = getCorsHeaders(event, 'GET, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: cors,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' })
      };
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error('JWT_SECRET not set!');
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const decoded = jwt.verify(token, jwtSecret);
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, company_name, subscription_tier, subscription_status, status, setup_completed')
      .eq('id', decoded.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!user || user.email !== decoded.email) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        company_name: user.company_name,
        subscription_tier: user.subscription_tier,
        subscription_status: user.subscription_status || 'active',
        status: user.status || 'active',
        setup_completed: user.setup_completed ?? false,
        is_admin: user.email === ADMIN_EMAIL
      })
    };
  } catch (error) {
    console.error('User endpoint error:', error);

    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return {
        statusCode: 401,
        headers: cors,
        body: JSON.stringify({ error: 'Invalid or expired token' })
      };
    }

    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Server error' })
    };
  }
};

export default modern(handler);
