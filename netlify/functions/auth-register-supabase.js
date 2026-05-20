import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendEmail, buildWelcomeEmail } from './lib/send-email.js';
import { getCorsHeaders } from './lib/cors.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
    const { email, password, company_name, invite_token } = JSON.parse(event.body);

    // Kräv inbjudningstoken
    if (!invite_token) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Inbjudningslänk krävs för att skapa konto.' }) };
    }

    // Validera token
    const { data: invite, error: inviteErr } = await supabase
      .from('invite_tokens')
      .select('id, email, expires_at, used_at')
      .eq('token', invite_token)
      .single();

    if (inviteErr || !invite) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Ogiltig inbjudningslänk.' }) };
    }
    if (invite.used_at) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Inbjudningslänken har redan använts.' }) };
    }
    if (new Date(invite.expires_at) < new Date()) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Inbjudningslänken har gått ut. Be om en ny.' }) };
    }

    // Validation
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Email and password required' })
      };
    }

    if (password.length < 6) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Password must be at least 6 characters' })
      };
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Insert user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          email,
          password_hash: hashedPassword,
          company_name: company_name || email.split('@')[0] + ' Company',
          subscription_tier: 'starter',
          subscription_status: 'active'
        }
      ])
      .select();

    if (insertError) {
      console.error('Insert error:', insertError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Registration failed: ' + insertError.message })
      };
    }

    const user = newUser[0];

    // Markera inbjudningstoken som använd
    await supabase.from('invite_tokens').update({
      used_at: new Date().toISOString(),
      used_by_user_id: user.id
    }).eq('token', invite_token);

    // Skicka välkomstmail (fire-and-forget)
    sendEmail({
      to: user.email,
      subject: 'Välkommen till Admiral — koppla ditt Meta-konto',
      html: buildWelcomeEmail({ name: company_name || user.email.split('@')[0] })
    }).catch(() => {}); // ignorera fel — registrering ska inte blockeras

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
        setup_completed: false
      },
      jwtSecret,
      { expiresIn: '24h' }
    );

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'User registered successfully',
        token,
        redirect: '/setup-wizard.html',
        user: {
          id: user.id,
          email: user.email,
          company_name: user.company_name,
          subscription_tier: user.subscription_tier,
          setup_completed: false
        }
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Registration failed: ' + error.message })
    };
  }
};
