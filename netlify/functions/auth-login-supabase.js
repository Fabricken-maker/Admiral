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
    const { email, password } = JSON.parse(event.body);

    // Validation
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Email and password required' })
      };
    }

    // Query user
    const { data: user, error: queryError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (queryError || !user) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Verify password
    const validPassword = await bcryptjs.compare(password, user.password_hash);

    if (!validPassword) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

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
