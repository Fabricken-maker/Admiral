-- Admiral Modul B — Granskning av annonsmaterial
-- brand_profiles: varumärkesprofil per kund (färger, typsnitt, logotyp, ord, Advantage+-inställningar).
-- creative_reviews: en granskning per bild eller videoomslag, med kontroller och domslut.
-- Bilder sparas i den privata lagringsytan "creatives" (Supabase Storage), aldrig publikt.

create table if not exists public.brand_profiles (
  user_id bigint primary key references public.users(id) on delete cascade,
  brand_name text,
  ad_account_ids text[] not null default '{}',
  -- [{ "hex": "#00d9ff", "name": "Cyan" }]
  palette jsonb not null default '[]'::jsonb,
  fonts text[] not null default '{}',
  logo_paths text[] not null default '{}',
  logo_notes text,
  product_notes text,
  tone_notes text,
  forbidden_words text[] not null default '{}',
  required_phrases text[] not null default '{}',
  -- Advantage+-förbättringar som inte får vara påslagna (Metas namn, t.ex. image_uncrop)
  blocked_features text[] not null default array[
    'image_uncrop', 'video_uncrop', 'image_background_gen', 'image_templates',
    'add_text_overlay', 'image_animation', 'text_generation', 'multi_photo_to_video', 'cv_transformation'
  ],
  updated_by bigint references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creative_reviews (
  id bigserial primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  ad_account_id text,
  source text not null check (source in ('meta', 'uppladdad')),
  ad_id text,
  ad_name text,
  ad_status text,
  campaign_name text,
  asset_key text not null,
  asset_type text not null check (asset_type in ('bild', 'video')),
  -- Samma bild, texter och inställningar ger samma nyckel och granskas inte igen.
  content_key text not null,
  -- En variant pekar på originalet den ska jämföras med.
  original_review_id bigint references public.creative_reviews(id) on delete set null,
  source_url text,
  image_path text,
  image_sha256 text,
  width integer,
  height integer,
  texts jsonb not null default '{}'::jsonb,
  features jsonb,
  checks jsonb not null default '[]'::jsonb,
  verdict text check (verdict in ('godkand', 'granska', 'underkand')),
  verdict_reason text,
  status text not null default 'koar' check (status in ('koar', 'analyserar', 'klar', 'fel')),
  error text,
  ai_model text,
  attempts integer not null default 0,
  analyzed_at timestamptz,
  decided_verdict text check (decided_verdict in ('godkand', 'underkand')),
  decided_by bigint references public.users(id),
  decided_at timestamptz,
  decision_note text,
  created_by bigint references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists creative_reviews_content_uniq
  on public.creative_reviews (user_id, coalesce(ad_id, ''), asset_key, content_key);
create index if not exists creative_reviews_user_created on public.creative_reviews (user_id, created_at desc);
create index if not exists creative_reviews_status on public.creative_reviews (status) where status in ('koar', 'analyserar');

alter table public.brand_profiles enable row level security;
alter table public.creative_reviews enable row level security;

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', false)
on conflict (id) do nothing;
