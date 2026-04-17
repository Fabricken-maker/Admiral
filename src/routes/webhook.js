import express from 'express';
import crypto from 'crypto';
import { getDb } from '../utils/db.js';

const router = express.Router();
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'admiral-webhook-token';
const META_APP_SECRET = process.env.META_APP_SECRET || '';

// GET /api/webhook - Meta webhook verification
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token) {
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// POST /api/webhook - Receive Meta webhooks
router.post('/', (req, res) => {
  try {
    // Verify webhook signature
    if (META_APP_SECRET) {
      const signature = req.headers['x-hub-signature-256'];
      if (signature) {
        const hash = crypto
          .createHmac('sha256', META_APP_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        
        const expectedSignature = `sha256=${hash}`;
        if (signature !== expectedSignature) {
          console.warn('Invalid webhook signature');
          return res.sendStatus(403);
        }
      }
    }
    
    const db = getDb();
    const body = req.body;
    
    // Log webhook
    db.prepare(`
      INSERT INTO webhook_logs (event_type, payload, processed)
      VALUES (?, ?, ?)
    `).run(
      body.object || 'unknown',
      JSON.stringify(body),
      0
    );
    
    // Process webhook asynchronously
    processWebhook(body).catch(err => {
      console.error('Webhook processing error:', err);
    });
    
    // Return 200 immediately
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Helper function to process webhooks
async function processWebhook(body) {
  const db = getDb();
  
  if (body.object === 'ad_account') {
    // Handle ad account changes
    const entries = body.entry || [];
    
    for (const entry of entries) {
      const changes = entry.changes || [];
      
      for (const change of changes) {
        console.log(`📊 Ad account event: ${change.field}`, change.value);
        
        // Process campaign budget changes
        if (change.field === 'campaign' && change.value) {
          const campaigns = change.value;
          for (const campaign of campaigns) {
            db.prepare(`
              UPDATE campaigns
              SET updated_at = CURRENT_TIMESTAMP
              WHERE meta_campaign_id = ?
            `).run(campaign.id);
          }
        }
        
        // Process campaign status changes
        if (change.field === 'campaigns' && change.value) {
          const campaignData = change.value;
          if (campaignData.id && campaignData.status) {
            db.prepare(`
              UPDATE campaigns
              SET status = ?, updated_at = CURRENT_TIMESTAMP
              WHERE meta_campaign_id = ?
            `).run(campaignData.status, campaignData.id);
          }
        }
      }
    }
  }
  
  // Mark as processed
  db.prepare(`
    UPDATE webhook_logs
    SET processed = ?, response = ?
    WHERE payload = ?
  `).run(1, 'processed', JSON.stringify(body));
}

// GET /api/webhook/logs - View recent webhooks (admin)
router.get('/logs', (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    
    const logs = db.prepare(`
      SELECT * FROM webhook_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

export default router;
