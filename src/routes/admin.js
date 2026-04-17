import express from 'express';
import { getDb } from '../utils/db.js';

const router = express.Router();

// Middleware to check admin status
function requireAdmin(req, res, next) {
  // In production, check user role from DB
  // For now, just verify authenticated
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/admin/stats - Get platform statistics
router.get('/stats', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const activeCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE status = ?').get('ACTIVE').count;
    const totalSubscriptions = db.prepare('SELECT SUM(price_monthly) as total FROM subscriptions WHERE status = ?').get('active').total || 0;
    const syncErrors = db.prepare('SELECT COUNT(*) as count FROM crm_sync_log WHERE status = ?').get('failed').count;
    
    res.json({
      users_total: userCount,
      campaigns_active: activeCampaigns,
      mrr: totalSubscriptions,
      sync_errors: syncErrors
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/users - List all users
router.get('/users', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const users = db.prepare(`
      SELECT id, email, company_name, subscription_tier, subscription_status, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    
    res.json({ users, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/crm-sync - View CRM sync logs
router.get('/crm-sync', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    
    const logs = db.prepare(`
      SELECT * FROM crm_sync_log
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    
    const summary = {
      total: db.prepare('SELECT COUNT(*) as count FROM crm_sync_log').get().count,
      pending: db.prepare('SELECT COUNT(*) as count FROM crm_sync_log WHERE status = ?').get('pending').count,
      success: db.prepare('SELECT COUNT(*) as count FROM crm_sync_log WHERE status = ?').get('success').count,
      failed: db.prepare('SELECT COUNT(*) as count FROM crm_sync_log WHERE status = ?').get('failed').count
    };
    
    res.json({ logs, summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sync logs' });
  }
});

// POST /api/admin/retry-sync/:id - Retry failed sync
router.post('/retry-sync/:id', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    
    db.prepare(`
      UPDATE crm_sync_log
      SET status = 'pending'
      WHERE id = ?
    `).run(req.params.id);
    
    res.json({ message: 'Sync retry scheduled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retry sync' });
  }
});

// GET /api/admin/health - System health check
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    
    // Test database connection
    const dbTest = db.prepare('SELECT 1').get();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbTest ? 'ok' : 'error',
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

export default router;
