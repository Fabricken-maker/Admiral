-- Admiral Budget Management Tables

CREATE TABLE IF NOT EXISTS budget_plans (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  ad_account_id TEXT NOT NULL,
  monthly_budget DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'SEK',
  month_start DATE NOT NULL,
  month_end DATE NOT NULL,
  status TEXT DEFAULT 'active',         -- active | paused | completed
  total_spent DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_set_allocations (
  id BIGSERIAL PRIMARY KEY,
  budget_plan_id BIGINT REFERENCES budget_plans(id) ON DELETE CASCADE,
  ad_set_id TEXT NOT NULL,
  ad_set_name TEXT,
  daily_budget_cents INTEGER DEFAULT 0,  -- stored in cents (Meta API format)
  allocation_pct DECIMAL(5,2) DEFAULT 0, -- % of daily pool
  last_roas DECIMAL(8,2) DEFAULT 0,
  last_spend DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spend_log (
  id BIGSERIAL PRIMARY KEY,
  budget_plan_id BIGINT REFERENCES budget_plans(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  planned_spend DECIMAL(10,2),
  actual_spend DECIMAL(10,2),
  pacing_ratio DECIMAL(6,4),            -- actual/planned, 1.0 = perfect
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_plans_campaign ON budget_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_budget_plans_status ON budget_plans(status);
CREATE INDEX IF NOT EXISTS idx_spend_log_date ON spend_log(log_date);
