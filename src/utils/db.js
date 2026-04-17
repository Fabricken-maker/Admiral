import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../admiral.db');
const FABRICKEN_DB_PATH = process.env.FABRICKEN_DB_PATH || '/root/.openclaw/workspace/crm/fabricken.db';

let db = null;
let fabrickenDb = null;

export function initializeDb() {
  try {
    // Initialize Admiral backend database
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    
    console.log(`✅ Admiral database initialized: ${DB_PATH}`);
    
    // Initialize Fabricken CRM connection
    fabrickenDb = new Database(FABRICKEN_DB_PATH, { readonly: true });
    console.log(`✅ Fabricken CRM database connected (readonly)`);
    
    return db;
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
  }
}

export function getDb() {
  if (!db) {
    initializeDb();
  }
  return db;
}

export function getFabrickenDb() {
  if (!fabrickenDb) {
    fabrickenDb = new Database(FABRICKEN_DB_PATH, { readonly: true });
  }
  return fabrickenDb;
}

// Schema initialization
export function initializeSchema() {
  const db = getDb();
  
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      company_name TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      fabricken_customer_id INTEGER,
      subscription_status TEXT DEFAULT 'active',
      subscription_tier TEXT DEFAULT 'starter',
      meta_ads_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Meta Ads Accounts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_ads_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id TEXT UNIQUE NOT NULL,
      access_token TEXT NOT NULL,
      account_name TEXT,
      currency TEXT DEFAULT 'SEK',
      timezone TEXT,
      is_active BOOLEAN DEFAULT 1,
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Campaigns table (synced with Meta)
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      meta_campaign_id TEXT UNIQUE,
      campaign_name TEXT NOT NULL,
      status TEXT DEFAULT 'PAUSED',
      budget REAL,
      daily_budget REAL,
      currency TEXT DEFAULT 'SEK',
      objective TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Subscriptions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      price_monthly REAL,
      status TEXT DEFAULT 'active',
      billing_cycle_start DATETIME,
      billing_cycle_end DATETIME,
      auto_renew BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Webhooks log
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id INTEGER,
      payload TEXT,
      processed BOOLEAN DEFAULT 0,
      response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  // CRM sync log
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      fabricken_customer_id INTEGER,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  console.log('✅ Database schema initialized');
}

export default getDb;
