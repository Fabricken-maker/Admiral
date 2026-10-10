import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';
import { createRateLimiter, normalizeEmail, clientIp, LIMITS } from './lib/rate-limit.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const handler = async (event, context) => {
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

    // ── Spärr mot upprepade försök (per e-post och per avsändare) ──
    const normEmail = normalizeEmail(email);
    const limiter = createRateLimiter(supabase);
    const rlKey = `login:${normEmail}`;
    const keys = [{ key: rlKey, max: LIMITS.email }, { key: `login-ip:${clientIp(event, context)}`, max: LIMITS.ip }];
    const { rows, wait } = await limiter.check(keys);
    if (wait > 0) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: `För många inloggningsförsök. Försök igen om ${wait} minut(er).` })
      };
    }

    // ── Hämta användare (exakt e-post; alla adresser sparas med små bokstäver) ──
    const { data: user, error: queryError } = await supabase
      .from('users')
      .select('*')
      .eq('email', normEmail)
      .maybeSingle();

    if (queryError || !user) {
      await limiter.fail(keys, rows);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // ── Verifiera lösenord ────────────────────────────────────
    const validPassword = await bcryptjs.compare(password, user.password_hash);

    if (!validPassword) {
      await limiter.fail(keys, rows);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // ── Rensa rate limit vid lyckad inloggning ────────────────
    await limiter.clear(rlKey);

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

    // ── Auto-detect setup completion ──────────────────────────
    // Kraven: Meta-token finns + minst en budget_plan finns
    let setupCompleted = user.setup_completed ?? false;
    if (!setupCompleted) {
      try {
        const [{ data: metaTok }, { data: plans }] = await Promise.all([
          supabase.from('meta_tokens').select('user_id').eq('user_id', user.id).maybeSingle(),
          supabase.from('budget_plans').select('id').eq('user_id', user.id).limit(1)
        ]);
        if (metaTok && plans && plans.length > 0) {
          setupCompleted = true;
          // Persistera så vi slipper kolla nästa gång
          await supabase.from('users').update({ setup_completed: true }).eq('id', user.id);
        }
      } catch (e) {
        console.error('Setup auto-detect failed:', e.message);
      }
    }
    user.setup_completed = setupCompleted;

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
      body: JSON.stringify({ error: 'Inloggningen misslyckades. Försök igen.' })
    };
  }
};

export default modern(handler);
