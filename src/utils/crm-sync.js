import { getDb, getFabrickenDb } from './db.js';

/**
 * Sync user registration/subscription to Fabricken CRM
 */
export async function syncUserToCRM(user, action = 'register') {
  try {
    const db = getDb();
    const fabrickenDb = getFabrickenDb();
    
    // Log the sync attempt
    const syncLogId = db.prepare(`
      INSERT INTO crm_sync_log (user_id, action, payload, status)
      VALUES (?, ?, ?, 'pending')
    `).run(
      user.id,
      action,
      JSON.stringify({
        email: user.email,
        company_name: user.company_name,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone
      })
    ).lastInsertRowid;
    
    // Check if customer exists in Fabricken CRM
    let fabrickenCustomerId = null;
    
    try {
      const existingCustomer = fabrickenDb.prepare(
        'SELECT id FROM customers WHERE email = ? LIMIT 1'
      ).get(user.email);
      
      if (existingCustomer) {
        fabrickenCustomerId = existingCustomer.id;
      }
    } catch (err) {
      console.log('Could not query customers table:', err.message);
    }
    
    // If no existing customer, insert new one (would normally require write access)
    if (!fabrickenCustomerId) {
      // Note: In production, this would be a call to Fabricken API
      // For now, we just log the intent
      console.log(`Would create customer in Fabricken: ${user.email}`);
    }
    
    // Update sync log
    db.prepare(`
      UPDATE crm_sync_log
      SET status = 'success', fabricken_customer_id = ?
      WHERE id = ?
    `).run(fabrickenCustomerId || null, syncLogId);
    
    return fabrickenCustomerId;
  } catch (err) {
    console.error('CRM sync error:', err);
    throw err;
  }
}

/**
 * Sync subscription change to Fabricken
 */
export async function syncSubscriptionChange(user, subscription, action) {
  try {
    const db = getDb();
    
    // Log the sync attempt
    db.prepare(`
      INSERT INTO crm_sync_log (user_id, action, payload, status)
      VALUES (?, ?, ?, 'pending')
    `).run(
      user.id,
      `subscription_${action}`,
      JSON.stringify({
        tier: subscription.tier,
        status: subscription.status,
        price_monthly: subscription.price_monthly
      })
    );
    
    // Notify Viktor for CRM update
    await notifyViktor({
      type: `subscription_${action}`,
      user_id: user.id,
      email: user.email,
      subscription_tier: subscription.tier,
      price: subscription.price_monthly
    });
    
  } catch (err) {
    console.error('Subscription sync error:', err);
  }
}

/**
 * Send notification to Viktor (Ekonomi-agent) via sessions_send
 */
export async function notifyViktor(payload) {
  try {
    // This would integrate with OpenClaw's sessions_send
    // For now, we log it and it would be sent via the webhook processor
    console.log('📊 Notification for Viktor:', payload);
    
    // In a real implementation, this would call OpenClaw's session API
    // Example structure:
    // POST http://localhost:3000/sessions/send
    // {
    //   "session_id": "viktor-session-id",
    //   "message": JSON.stringify(payload),
    //   "type": "notification"
    // }
    
  } catch (err) {
    console.error('Viktor notification failed:', err);
  }
}

/**
 * Get customer insights from Fabricken CRM
 */
export function getCustomerInsights(fabrickenCustomerId) {
  try {
    const fabrickenDb = getFabrickenDb();
    
    // Get customer data
    const customer = fabrickenDb.prepare(
      'SELECT * FROM customers WHERE id = ? LIMIT 1'
    ).get(fabrickenCustomerId);
    
    // Get customer interactions
    const interactions = fabrickenDb.prepare(
      'SELECT * FROM interactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10'
    ).all(fabrickenCustomerId);
    
    // Get customer projects
    const projects = fabrickenDb.prepare(
      'SELECT * FROM projects WHERE customer_id = ? ORDER BY created_at DESC'
    ).all(fabrickenCustomerId);
    
    return {
      customer,
      interactions,
      projects,
      interaction_count: interactions.length,
      project_count: projects.length
    };
  } catch (err) {
    console.error('Failed to get customer insights:', err);
    return null;
  }
}

export default syncUserToCRM;
