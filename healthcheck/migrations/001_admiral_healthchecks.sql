-- Admiral Weekly Health Check: en rad per körning.
create table if not exists public.admiral_healthchecks (
  id bigserial primary key,
  run_id uuid not null unique,
  run_key text not null,
  trigger text not null check (trigger in ('scheduled', 'manual', 'test')),
  dry_run boolean not null default false,
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms integer,
  status text not null check (status in ('GRÖN', 'GUL', 'RÖD')),
  checks_total integer not null default 0,
  checks_ok integer not null default 0,
  deviations jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  report_text text,
  module_version text,
  created_at timestamptz not null default now()
);

-- En schemalagd körning per vecka (idempotens vid dubbel cron-start).
create unique index if not exists admiral_healthchecks_weekly_key
  on public.admiral_healthchecks (run_key) where trigger = 'scheduled';
create index if not exists admiral_healthchecks_started_at on public.admiral_healthchecks (started_at desc);

-- Bara service role (modulen) läser och skriver.
alter table public.admiral_healthchecks enable row level security;

comment on table public.admiral_healthchecks is
  'Admiral Weekly Health Check: tidpunkt, status (GRÖN/GUL/RÖD), avvikelser och åtgärder per körning.';
