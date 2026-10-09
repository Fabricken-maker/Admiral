-- Admiral Modul D — Godkännandeflöde med ett klick (+ enkel Modul A)
-- Allt här är tillägg. Befintliga tabeller ändras bara genom en ny kolumn i meta_tokens.

-- ── Skrivbehörighet, nödstopp och gränser per kund ─────────────────────────
create table if not exists public.write_settings (
  user_id bigint primary key references public.users(id) on delete cascade,
  writes_enabled boolean not null default false,          -- skrivbehörighet beviljad för kunden
  kill_switch boolean not null default false,             -- true = alla skrivningar stoppade
  kill_switch_at timestamptz,
  kill_switch_by bigint references public.users(id),
  ad_account_ids text[] not null default '{}',            -- konton som får ändras
  max_change_pct_per_action numeric not null default 30 check (max_change_pct_per_action > 0),
  max_change_sek_per_action numeric not null default 1500 check (max_change_sek_per_action >= 0), -- kr/mån
  max_change_sek_per_period numeric not null default 3000 check (max_change_sek_per_period >= 0), -- kr/mån, summa
  max_actions_per_period integer not null default 10 check (max_actions_per_period >= 0),
  period_days integer not null default 30 check (period_days > 0),
  monthly_budget_cap_sek numeric check (monthly_budget_cap_sek is null or monthly_budget_cap_sek >= 0), -- tak mot förbetald kredit
  approval_ttl_hours integer not null default 72 check (approval_ttl_hours > 0),
  updated_at timestamptz not null default now()
);

-- ── Förslag ────────────────────────────────────────────────────────────────
create table if not exists public.proposals (
  id bigserial primary key,
  user_id bigint not null references public.users(id) on delete cascade, -- kunden
  ad_account_id text not null,
  type text not null check (type in ('budget_change', 'ad_status', 'apply_recommendation')),
  kind text not null default 'change' check (kind in ('change', 'undo')),
  undo_of_write_id bigint,
  object_type text not null check (object_type in ('campaign', 'adset', 'ad', 'account')),
  object_id text not null,
  object_name text,
  current_value jsonb not null,
  proposed_value jsonb not null,
  meta jsonb not null default '{}'::jsonb,               -- t.ex. recommendation_signature, extra_data
  reason text not null,                                  -- en mening från Modul A, byggd av siffror
  reason_data jsonb not null default '{}'::jsonb,        -- utlåtande + 2–3 stödsiffror
  expected_outcome jsonb not null default '{}'::jsonb,   -- från budgetsimulatorn
  confirmation_text text not null,                       -- "Din budget går från X till Y kr/mån."
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'verifying', 'done', 'failed', 'superseded')),
  status_reason text,
  source text not null check (source in ('admin', 'modul_a', 'budget_adjust', 'budget_activate', 'undo')),
  created_by bigint references public.users(id),
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists proposals_user_status on public.proposals (user_id, status, created_at desc);
-- Högst ett väntande förslag per objekt och typ
create unique index if not exists proposals_one_pending_per_object
  on public.proposals (user_id, object_id, type) where status = 'pending';

-- ── Godkännanden (ett per förslag, används en gång) ────────────────────────
create table if not exists public.approvals (
  id bigserial primary key,
  proposal_id bigint not null unique references public.proposals(id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject')),
  decided_by bigint not null references public.users(id),
  on_behalf boolean not null default false,              -- Fabricken godkände å kundens vägnar
  confirmation_text text,                                -- texten som visades vid bekräftelsen
  decided_at timestamptz not null default now(),
  valid_until timestamptz,                               -- godkännandet kan användas till hit
  consumed_at timestamptz                                -- satt = använt (kan inte användas igen)
);

-- ── Logg över varje skrivning mot Meta ─────────────────────────────────────
create table if not exists public.meta_write_log (
  id bigserial primary key,
  proposal_id bigint not null references public.proposals(id),
  approval_id bigint not null references public.approvals(id),
  user_id bigint not null references public.users(id),
  actor_id bigint not null references public.users(id),
  on_behalf boolean not null default false,
  ad_account_id text not null,
  object_id text not null,
  action text not null check (action in ('apply', 'undo')),
  before jsonb not null,                                 -- läst från Meta precis före skrivningen
  request jsonb not null,                                -- vad som skickades (utan token)
  response jsonb,                                        -- Metas svar
  after jsonb,                                           -- läst tillbaka från Meta
  status text not null check (status in ('verifying', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists meta_write_log_user on public.meta_write_log (user_id, created_at desc);
create index if not exists meta_write_log_object on public.meta_write_log (object_id, created_at desc);

-- ── Modul A: Metas rekommendationer bedömda från egen data ─────────────────
create table if not exists public.meta_recommendations (
  id bigserial primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  ad_account_id text not null,
  type text not null,
  recommendation_signature text,                         -- finns bara om API-applicering stöds
  object_ids jsonb not null default '[]'::jsonb,
  body text,
  opportunity_score_lift numeric,
  url text,
  raw jsonb not null,
  verdict text not null check (verdict in ('gor', 'avvakta', 'avsta', 'for_lite_data')),
  verdict_reason text not null,
  support jsonb not null default '[]'::jsonb,            -- 2–3 stödsiffror
  proposal_id bigint references public.proposals(id),
  fetched_at timestamptz not null default now(),
  unique (ad_account_id, type, recommendation_signature)
);

-- ── Krypterade Meta-token (Supabase Vault) ─────────────────────────────────
alter table public.meta_tokens add column if not exists token_secret_id uuid;
alter table public.meta_tokens alter column access_token drop not null;

create or replace function public.meta_token_get(p_user_id bigint)
returns table (user_id bigint, access_token text, expires_at timestamp, meta_user_id text, encrypted boolean)
language sql stable security definer set search_path = public, vault, pg_temp as $$
  select t.user_id,
         coalesce(s.decrypted_secret, t.access_token),
         t.expires_at,
         t.meta_user_id,
         t.token_secret_id is not null
  from public.meta_tokens t
  left join vault.decrypted_secrets s on s.id = t.token_secret_id
  where t.user_id = p_user_id;
$$;

create or replace function public.meta_token_put(p_user_id bigint, p_token text, p_expires_at timestamp, p_meta_user_id text)
returns void
language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare
  v_secret uuid;
begin
  select token_secret_id into v_secret from public.meta_tokens where user_id = p_user_id;
  if v_secret is null then
    select id into v_secret from vault.secrets where name = 'meta_token_user_' || p_user_id;
  end if;
  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'meta_token_user_' || p_user_id, 'Meta access token (Admiral)');
  else
    perform vault.update_secret(v_secret, p_token);
  end if;
  insert into public.meta_tokens (user_id, access_token, token_secret_id, expires_at, meta_user_id, updated_at)
  values (p_user_id, null, v_secret, p_expires_at, p_meta_user_id, now())
  on conflict (user_id) do update
    set access_token = null,
        token_secret_id = v_secret,
        expires_at = excluded.expires_at,
        meta_user_id = coalesce(excluded.meta_user_id, public.meta_tokens.meta_user_id),
        updated_at = now();
end;
$$;

revoke all on function public.meta_token_get(bigint) from public, anon, authenticated;
revoke all on function public.meta_token_put(bigint, text, timestamp, text) from public, anon, authenticated;
grant execute on function public.meta_token_get(bigint) to service_role;
grant execute on function public.meta_token_put(bigint, text, timestamp, text) to service_role;

-- Bara service role (Netlify-funktionerna och hälsokollen) läser och skriver.
alter table public.write_settings enable row level security;
alter table public.proposals enable row level security;
alter table public.approvals enable row level security;
alter table public.meta_write_log enable row level security;
alter table public.meta_recommendations enable row level security;

comment on table public.proposals is 'Modul D: förslag på ändringar i Meta som kunden (eller Fabricken å kundens vägnar) godkänner.';
comment on table public.approvals is 'Modul D: registrerade godkännanden. Ett per förslag, används en gång (consumed_at).';
comment on table public.meta_write_log is 'Modul D: varje skrivning mot Meta med före/efter, Metas svar och verifiering.';
comment on table public.write_settings is 'Modul D: skrivbehörighet, nödstopp och gränser per kund.';
comment on table public.meta_recommendations is 'Modul A: Metas rekommendationer med utlåtande från Admirals egen data.';
