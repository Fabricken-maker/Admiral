-- Admiral: logg över utskickade påminnelser, så att samma mejl aldrig skickas två gånger.
-- Används av nightly-health-check (mejl om Meta-kopplingen): en rad per användare, koppling och läge.
-- ref = kopplingens utgångstid (ISO). En ny koppling har en ny ref, och lägena börjar om.

create table if not exists public.notice_log (
  id bigserial primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  kind text not null,
  ref text not null,
  state text not null,
  email_id text,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, ref, state)
);

alter table public.notice_log enable row level security;
