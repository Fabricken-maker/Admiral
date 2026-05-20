import jwt from 'jsonwebtoken';
import { getCorsHeaders } from './lib/cors.js';

export const handler = async (event, context) => {
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

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        id: decoded.id,
        email: decoded.email,
        subscription_tier: decoded.subscription_tier,
        subscription_status: 'active'
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
