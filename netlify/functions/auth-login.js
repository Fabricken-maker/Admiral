import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock database (same as register)
const users = {
  'test@example.com': {
    id: 1,
    email: 'test@example.com',
    password: '$2a$10$lkQ5D2CXzYyOvYo0D0C0.e4YMxKvHDhC6uZ8xKk9L9lK9K9K9K9K9',
    company_name: 'Test Company',
    subscription_tier: 'starter',
    subscription_status: 'active'
  }
};

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing email or password' })
      };
    }

    const user = users[email];

    if (!user) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Generate token - MUST use .env JWT_SECRET (never hardcode!)
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('CRITICAL: JWT_SECRET not set in environment!');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, subscription_tier: user.subscription_tier },
      jwtSecret,
      { expiresIn: '24h' }
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          company_name: user.company_name,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status
        }
      })
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Login failed' })
    };
  }
};
