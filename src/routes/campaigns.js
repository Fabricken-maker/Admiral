import express from 'express';
import { getDb } from '../utils/db.js';
import axios from 'axios';

const router = express.Router();
const META_API_VERSION = 'v19.0';

// GET /api/campaigns - List user's campaigns
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const campaigns = db.prepare(`
      SELECT * FROM campaigns
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.user.id);
    
    res.json({ campaigns });
  } catch (err) {
    console.error('Get campaigns error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// POST /api/campaigns/connect-meta - Connect Meta Ads account
router.post('/connect-meta', async (req, res) => {
  try {
    const { account_id, access_token, account_name } = req.body;
    
    if (!account_id || !access_token) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify token with Meta API
    try {
      const response = await axios.get(
        `https://graph.facebook.com/${META_API_VERSION}/me`,
        { params: { access_token } }
      );
      
      if (!response.data.id) {
        return res.status(401).json({ error: 'Invalid Meta access token' });
      }
    } catch (metaErr) {
      return res.status(401).json({ error: 'Meta API verification failed' });
    }
    
    // Store account
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO meta_ads_accounts (user_id, account_id, access_token, account_name)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, account_id, access_token, account_name || 'Primary Account');
    
    res.json({
      message: 'Meta Ads account connected',
      account_id: account_id,
      connection_id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Meta connection error:', err);
    res.status(500).json({ error: 'Failed to connect Meta account' });
  }
});

// GET /api/campaigns/meta-accounts - List connected Meta accounts
router.get('/meta-accounts', (req, res) => {
  try {
    const db = getDb();
    const accounts = db.prepare(`
      SELECT id, account_id, account_name, is_active, connected_at
      FROM meta_ads_accounts
      WHERE user_id = ?
    `).all(req.user.id);
    
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Meta accounts' });
  }
});

// POST /api/campaigns/sync-from-meta - Sync campaigns from Meta
router.post('/sync-from-meta', async (req, res) => {
  try {
    const { meta_account_id } = req.body;
    const db = getDb();
    
    // Get Meta account credentials
    const metaAccount = db.prepare(
      'SELECT * FROM meta_ads_accounts WHERE id = ? AND user_id = ?'
    ).get(meta_account_id, req.user.id);
    
    if (!metaAccount) {
      return res.status(404).json({ error: 'Meta account not found' });
    }
    
    // Fetch campaigns from Meta API
    try {
      const response = await axios.get(
        `https://graph.facebook.com/${META_API_VERSION}/${metaAccount.account_id}/campaigns`,
        {
          params: {
            fields: 'id,name,status,daily_budget,lifetime_budget,objective',
            access_token: metaAccount.access_token
          }
        }
      );
      
      // Insert/update campaigns
      const campaigns = response.data.data || [];
      for (const campaign of campaigns) {
        db.prepare(`
          INSERT INTO campaigns (user_id, meta_campaign_id, campaign_name, status, daily_budget, objective)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(meta_campaign_id) DO UPDATE SET
            campaign_name = excluded.campaign_name,
            status = excluded.status,
            daily_budget = excluded.daily_budget,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          req.user.id,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.daily_budget,
          campaign.objective
        );
      }
      
      res.json({
        message: `${campaigns.length} campaigns synced`,
        campaigns_synced: campaigns.length
      });
    } catch (metaErr) {
      console.error('Meta API error:', metaErr.response?.data || metaErr.message);
      return res.status(500).json({ error: 'Failed to fetch from Meta API' });
    }
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// PUT /api/campaigns/:id - Update campaign
router.put('/:id', async (req, res) => {
  try {
    const { campaign_name, daily_budget, status } = req.body;
    const campaignId = req.params.id;
    
    const db = getDb();
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(campaignId, req.user.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Update in local DB
    db.prepare(`
      UPDATE campaigns
      SET campaign_name = COALESCE(?, campaign_name),
          daily_budget = COALESCE(?, daily_budget),
          status = COALESCE(?, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(campaign_name, daily_budget, status, campaignId);
    
    // Sync to Meta if it's a Meta campaign
    if (campaign.meta_campaign_id && status) {
      try {
        const metaAccount = db.prepare(
          'SELECT * FROM meta_ads_accounts WHERE user_id = ? LIMIT 1'
        ).get(req.user.id);
        
        if (metaAccount) {
          await axios.post(
            `https://graph.facebook.com/${META_API_VERSION}/${campaign.meta_campaign_id}`,
            { status },
            { params: { access_token: metaAccount.access_token } }
          );
        }
      } catch (metaErr) {
        console.error('Meta update failed:', metaErr);
        // Non-fatal, still return success
      }
    }
    
    const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    res.json({ message: 'Campaign updated', campaign: updated });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// DELETE /api/campaigns/:id - Delete campaign
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

export default router;
