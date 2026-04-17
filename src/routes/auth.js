import express from 'express';
import bcryptjs from 'bcryptjs';
import { generateToken } from '../middleware/auth.js';
import { getDb } from '../utils/db.js';
import { syncUserToCRM, notifyViktor } from '../utils/crm-sync.js';

const router = express.Router();

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, company_name, first_name, last_name, phone } = req.body;
    
    // Validate input
    if (!email || !password || !company_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const db = getDb();
    
    // Check if user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);
    
    // Create user
    const result = db.prepare(`
      INSERT INTO users (email, password, company_name, first_name, last_name, phone, subscription_status, subscription_tier)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 'starter')
    `).run(email, hashedPassword, company_name, first_name, last_name, phone);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    
    // Sync to CRM
    try {
      const fabrickenCustomerId = await syncUserToCRM(user, 'register');
      db.prepare('UPDATE users SET fabricken_customer_id = ? WHERE id = ?').run(fabrickenCustomerId, user.id);
      
      // Notify Viktor
      await notifyViktor({
        type: 'customer_registered',
        user_id: user.id,
        email: user.email,
        company_name,
        fabricken_id: fabrickenCustomerId
      });
    } catch (crmErr) {
      console.error('CRM sync failed:', crmErr);
      // Continue anyway - don't block registration
    }
    
    // Generate token
    const token = generateToken(user);
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        company_name: user.company_name,
        subscription_tier: user.subscription_tier
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const passwordMatch = await bcryptjs.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        company_name: user.company_name,
        subscription_tier: user.subscription_tier,
        subscription_status: user.subscription_status
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/profile
router.get('/profile', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token' });
    }
    
    const db = getDb();
    const user = db.prepare('SELECT id, email, company_name, first_name, last_name, subscription_tier, subscription_status FROM users WHERE id = ?').get(req.user?.id || 0);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
