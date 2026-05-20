import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minuter
const MAX_ATTEMPTS   = 5;
const BLOCK_MINUTES  = 15;

async function incrementRateLimit(key, existing) {
  const now = new Date();
  const inWindow = existing && (now - new Date(existing.window_start)) < RATE_WINDOW_MS;
  const attempts = inWindow ? existing.attempts + 1 : 1;
  const blockedUntil = attempts >= MAX_ATTEMPTS
    ? new Date(Date.now() + BLOCK_MINUTES * 60000).toISOString()
    : null;
  await supabase.from('rate_limits').upsert(
    { key, attempts, window_start: inWindow ? existing.window_start : now.toISOString(), blocked_until: blockedUntil },
    { onConflict: 'key' }
  );
}

export const handler = async (event, context) => {
  const corsHeaders = getCorsHeaders(event, 'POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    // Validation
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Email and password required' })
      };
    }

    // ── Rate limiting ─────────────────────────────────────────
    const rlKey = `login:${email.toLowerCase()}`;
    const { data: rl } = await supabase
      .from('rate_limits')
      .select('attempts, window_start, blocked_until')
      .eq('key', rlKey)
      .maybeSingle();

    if (rl?.blocked_until && new Date(rl.blocked_until) > new Date()) {
      const waitMin = Math.ceil((new Date(rl.blocked_until) - Date.now()) / 60000);
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: `För många inloggningsförsök. Försök igen om ${waitMin} minut(er).` })
      };
    }

    // ── Hämta användare ───────────────────────────────────────
    const { data: user, error: queryError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (queryError || !user) {
      await incrementRateLimit(rlKey, rl);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // ── Verifiera lösenord ────────────────────────────────────
    const validPassword = await bcryptjs.compare(password, user.password_hash);

    if (!validPassword) {
      await incrementRateLimit(rlKey, rl);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // ── Rensa rate limit vid lyckad inloggning ────────────────
    await supabase.from('rate_limits').delete().eq('key', rlKey);

    // Check account status
    if (user.status === 'paused') {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Ditt konto är pausat. Kontakta Admiral för att återaktivera.' })
      };
    }
    if (user.status === 'terminated') {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Detta konto har avslutats.' })
      };
    }

    // Update last login
    await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET not set!');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        subscription_tier: user.subscription_tier,
        setup_completed: user.setup_completed ?? false
      },
      jwtSecret,
      { expiresIn: '24h' }
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          company_name: user.company_name,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status,
          setup_completed: user.setup_completed ?? false
        }
      })
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Login failed: ' + error.message })
    };
  }
};
