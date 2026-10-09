-- Admiral Modul C — Veckoutveckling
-- weekly_settings: vilka kunder som har veckovy, deras konton, mål och trösklar.
-- weekly_metrics: veckosiffror per kund, konto och kampanj, synkade från Meta av weekly-sync.

create table if not exists public.weekly_settings (
  user_id bigint primary key references public.users(id) on delete cascade,
  ad_account_ids text[] not null,
  tolerance_pct numeric not null default 5 check (tolerance_pct >= 0 and tolerance_pct < 100),
  min_spend_sek numeric not null default 300 check (min_spend_sek >= 0),
  min_results integer not null default 3 check (min_results >= 0),
  -- Alternativa namn på SAMMA resultat (t.ex. purchase/omni_purchase). Största värdet räknas, aldrig summan.
  result_action_types text[] not null default array['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'],
  target_cpa numeric check (target_cpa is null or target_cpa > 0),
  target_roas numeric check (target_roas is null or target_roas > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_metrics (
  id bigserial primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  ad_account_id text not null,
  campaign_id text not null, -- '_konto' = kontots veckosumma
  campaign_name text,
  week_start date not null check (extract(isodow from week_start) = 1),
  week_end date not null check (week_end = week_start + 6),
  spend numeric(12, 2) not null default 0,
  results numeric not null default 0,
  revenue numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  actions jsonb not null default '[]'::jsonb,
  action_values jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null,
  -- true tills raden hämtats minst 72 h efter veckoslut (Meta justerar i efterhand)
  is_preliminary boolean not null,
  unique (user_id, ad_account_id, campaign_id, week_start)
);

create index if not exists weekly_metrics_user_week on public.weekly_metrics (user_id, week_start desc);

-- Bara service role (Netlify-funktionerna och hälsokollen) läser och skriver.
alter table public.weekly_settings enable row level security;
alter table public.weekly_metrics enable row level security;

comment on table public.weekly_settings is
  'Modul C Veckoutveckling: kunder med veckovy, annonskonton, mål (CPA/ROAS), tolerans för oförändrat och datatrösklar.';
comment on table public.weekly_metrics is
  'Modul C Veckoutveckling: veckosiffror (mån–sön, Europe/Stockholm) från Meta per kund, konto och kampanj. campaign_id _konto = kontosumma.';
