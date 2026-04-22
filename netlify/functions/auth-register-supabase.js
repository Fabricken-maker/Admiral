import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('CRITICAL: Supabase credentials not configured!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// CORS headers
const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export const handler = async (event, context) => {
  // Handle CORS preflight
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
    const { email, password, company_name } = JSON.parse(event.body);

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
