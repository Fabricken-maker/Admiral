-- Spärr mot upprepade inloggningsförsök (netlify/functions/lib/rate-limit.js).
-- Nycklar: login:<e-post> och login-ip:<avsändare>. Bara service role når tabellen (RLS utan policyer).
create table if not exists public.rate_limits (
  key text primary key,
  attempts integer not null default 1,
  window_start timestamptz not null default now(),
  blocked_until timestamptz
);

alter table public.rate_limits enable row level security;

-- Gamla rader kan rensas när som helst:
-- delete from public.rate_limits where window_start < now() - interval '1 day';
