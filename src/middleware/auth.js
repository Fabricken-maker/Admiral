import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'admiral-secret-key-change-in-production';

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      subscription_tier: user.subscription_tier
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export default authMiddleware;
