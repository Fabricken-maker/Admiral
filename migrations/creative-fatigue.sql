-- Admiral Modul E — Kreativ trötthet → färdigt förslag
-- fatigue_settings: trösklar och minsta datamängd per kund (rad saknas = standardvärden).
-- ad_fatigue: annonser som tappat effekt, med siffrorna, varianterna och uppföljningen efter bytet.
-- Varianterna är granskningar i creative_reviews (Modul B) med fatigue_id. Bara varianter med
-- domslutet Godkänd blir förslag i Modul D (proposals.type = 'creative_swap').

create table if not exists public.fatigue_settings (
  user_id bigint primary key references public.users(id) on delete cascade,
  enabled boolean not null default true,
  lookback_weeks integer not null default 10 check (lookback_weeks between 4 and 26),
  baseline_weeks integer not null default 2 check (baseline_weeks between 1 and 4),
  min_impressions_week integer not null default 1000 check (min_impressions_week >= 0),
  min_spend_week_sek numeric not null default 100 check (min_spend_week_sek >= 0),
  min_results integer not null default 3 check (min_results >= 0),
  min_frequency numeric not null default 2.5 check (min_frequency > 0),
  frequency_rise_pct numeric not null default 20 check (frequency_rise_pct >= 0),
  ctr_drop_pct numeric not null default 20 check (ctr_drop_pct > 0 and ctr_drop_pct < 100),
  cpa_rise_pct numeric not null default 20 check (cpa_rise_pct >= 0),
  copy_variants integer not null default 2 check (copy_variants between 0 and 4),
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_fatigue (
  id bigserial primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  ad_account_id text not null,
  ad_id text not null,
  ad_name text,
  adset_id text,
  campaign_id text,
  campaign_name text,
  -- Veckan (måndag) då tröttheten senast mättes
  week_start date not null,
  -- { baseline: {...}, recent: {...}, change: { frequency, ctr, cpa } }, räknat av lib/fatigue.js
  metrics jsonb not null,
  status text not null default 'trott'
    check (status in ('trott', 'ersatt', 'avfardad', 'aterhamtad')),
  status_note text,
  -- Granskningen (Modul B) av annonsens bild eller videoomslag som varianterna utgår från
  original_review_id bigint references public.creative_reviews(id) on delete set null,
  variants_requested_at timestamptz,
  variants_generated_at timestamptz,
  proposal_id bigint references public.proposals(id) on delete set null,
  new_ad_id text,
  swapped_at timestamptz,
  followup jsonb,
  followup_at timestamptz,
  dismissed_by bigint references public.users(id),
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Högst en öppen trötthet per annons
create unique index if not exists ad_fatigue_open_uniq on public.ad_fatigue (user_id, ad_id) where status = 'trott';
create index if not exists ad_fatigue_user on public.ad_fatigue (user_id, detected_at desc);

alter table public.creative_reviews add column if not exists fatigue_id bigint references public.ad_fatigue(id) on delete set null;
alter table public.creative_reviews add column if not exists variant_label text;
alter table public.creative_reviews drop constraint if exists creative_reviews_source_check;
alter table public.creative_reviews add constraint creative_reviews_source_check check (source in ('meta', 'uppladdad', 'admiral'));
create index if not exists creative_reviews_fatigue on public.creative_reviews (fatigue_id) where fatigue_id is not null;

alter table public.proposals drop constraint if exists proposals_type_check;
alter table public.proposals add constraint proposals_type_check check (type in ('budget_change', 'ad_status', 'apply_recommendation', 'creative_swap'));
alter table public.proposals drop constraint if exists proposals_source_check;
alter table public.proposals add constraint proposals_source_check check (source in ('admin', 'modul_a', 'budget_adjust', 'budget_activate', 'undo', 'modul_e'));

alter table public.fatigue_settings enable row level security;
alter table public.ad_fatigue enable row level security;
