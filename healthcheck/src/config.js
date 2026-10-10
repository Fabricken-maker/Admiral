// Konfiguration för Admiral Weekly Health Check.
// Läser healthcheck/.env (om den finns) utan att skriva över redan satta variabler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function buildConfig(env = process.env) {
  return {
    root: ROOT,
    version: '1.0.0',
    baseUrl: (env.ADMIRAL_BASE_URL || 'https://admiralai.se').replace(/\/$/, ''),
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_SERVICE_KEY,
    jwtSecret: env.JWT_SECRET,
    adminEmail: env.ADMIRAL_ADMIN_EMAIL || 'admin@admiralai.se',
    meta: {
      apiVersion: env.META_API_VERSION || 'v25.0',
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
    },
    netlify: {
      token: env.NETLIFY_AUTH_TOKEN || null,
      siteId: env.NETLIFY_SITE_ID || '704d9d07-cc55-48b7-a01f-87340d6f9bea',
    },
    telegram: {
      token: env.TELEGRAM_BOT_TOKEN || null,
      chatId: env.TELEGRAM_CHAT_ID || null,
    },
    browser: {
      wsEndpoint: env.BROWSER_WS_ENDPOINT || null,
      chromePath: env.CHROME_PATH || null,
    },
    chroma: {
      url: env.CHROMA_URL || null,
      container: env.CHROMA_CONTAINER || null,
    },
    timeouts: {
      agentMs: Number(env.HC_AGENT_TIMEOUT_MS || 180_000),
      verifierMs: Number(env.HC_VERIFIER_TIMEOUT_MS || 120_000),
      httpMs: Number(env.HC_HTTP_TIMEOUT_MS || 20_000),
    },
    tolerance: {
      relative: 0.01, // ±1 % för belopp och mått
      absoluteFloor: 0.01, // öresavrundning
    },
    tokenWarnDays: 14,
    dataLagDays: 3, // Meta justerar retroaktivt — jämför bara dygn äldre än så
    storedWindowDays: 7, // lagrad spend_log-data som kontrolleras per körning
    timezone: 'Europe/Stockholm',
    stateDir: env.HC_STATE_DIR || path.join(ROOT, 'state'),
  };
}

// Variabler som Admirals Netlify-funktioner använder utan fallback
// och som behövs på dashboardens laddväg eller i schemalagda jobb.
export const REQUIRED_NETLIFY_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_ACCESS_TOKEN',
  'GA4_PROPERTY_ID',
  'GA4_SERVICE_ACCOUNT_JSON',
  'RESEND_API_KEY',
];

// Tabeller som Admirals kod läser/skriver (from('…') i netlify/functions).
export const REQUIRED_TABLES = [
  'users',
  'budget_plans',
  'ad_set_allocations',
  'spend_log',
  'health_reports',
  'meta_tokens',
  'mcp_api_keys',
  'webhook_subscriptions',
  'invite_tokens',
  'manual_conversions',
  'ga4_metrics',
  'campaign_assets',
  'rate_limits',
  'weekly_settings',
  'weekly_metrics',
  'write_settings',
  'proposals',
  'approvals',
  'meta_write_log',
  'meta_recommendations',
  'notice_log',
  'brand_profiles',
  'creative_reviews',
];

// Var i koden en tabell används — så att "kräver människa" kan peka ut platsen.
export const TABLE_USAGE = {
  rate_limits: 'netlify/functions/auth-login-supabase.js (inloggningsspärr)',
};

// Schemalagda Netlify-funktioner som ska finnas i aktuell deploy.
export const EXPECTED_SCHEDULES = {
  'budget-adjust': '0 6 * * *',
  'nightly-health-check': '0 7 * * *',
  'weekly-sync': '15 5 * * *',
  'proposals-maintenance': '*/15 * * * *',
  'recommendations-sync': '45 4 * * *',
  'reviews-sync': '30 5 * * *',
};
