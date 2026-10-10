import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendEmail, buildWelcomeEmail } from './lib/send-email.js';
import { normalizeEmail } from './lib/rate-limit.js';
import { getCorsHeaders } from './lib/cors.js';
import { modern } from './lib/modern.js';

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
    // En inbjudan till en viss adress gäller bara den adressen.
    const normEmail = normalizeEmail(email);
    if (invite.email && normalizeEmail(invite.email) !== normEmail) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'E-postadressen matchar inte inbjudan.' }) };
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

    // Check if user exists (exakt e-post; alla adresser sparas med små bokstäver)
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normEmail)
      .maybeSingle();

    if (existingUser) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Inbjudan tas atomärt: två registreringar samtidigt kan inte använda samma länk.
    const { data: claimed } = await supabase.from('invite_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id).is('used_at', null).select('id');
    if (!claimed?.length) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Inbjudningslänken har redan använts.' }) };
    }
    const releaseInvite = () => supabase.from('invite_tokens').update({ used_at: null }).eq('id', invite.id);

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Insert user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          email: normEmail,
          password_hash: hashedPassword,
          company_name: company_name || email.split('@')[0] + ' Company',
          subscription_tier: 'starter',
          subscription_status: 'active'
        }
      ])
      .select();

    if (insertError) {
      console.error('Insert error:', insertError);
      await releaseInvite();
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: insertError.code === '23505' ? 'User already exists' : 'Registreringen misslyckades. Försök igen.' })
      };
    }

    const user = newUser[0];

    // Koppla inbjudan till kontot (den togs redan ovan)
    await supabase.from('invite_tokens').update({ used_by_user_id: user.id }).eq('id', invite.id);

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

export default modern(handler);
