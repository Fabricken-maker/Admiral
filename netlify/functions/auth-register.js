import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock database (in production, use a real database)
const users = {};

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password, company_name } = JSON.parse(event.body);

    if (!email || !password || !company_name) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Check if user exists
    if (users[email]) {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = Object.keys(users).length + 1;
    users[email] = {
      id: userId,
      email,
      password: hashedPassword,
      company_name,
      subscription_tier: 'starter',
      subscription_status: 'active',
      created_at: new Date().toISOString()
    };

    // Generate token
    const token = jwt.sign(
      { id: userId, email, subscription_tier: 'starter' },
      process.env.JWT_SECRET || 'test-secret-key',
      { expiresIn: '24h' }
    );

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'User registered successfully',
        token,
        user: {
          id: userId,
          email,
          company_name,
          subscription_tier: 'starter'
        }
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Registration failed' })
    };
  }
};
