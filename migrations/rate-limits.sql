-- Rate limiting table for auth endpoints
create table if not exists rate_limits (
  key text primary key,
  attempts integer not null default 1,
  window_start timestamptz not null default now(),
  blocked_until timestamptz
);

-- Auto-clean old entries (optional, run as cron or manually)
-- delete from rate_limits where window_start < now() - interval '1 hour';
