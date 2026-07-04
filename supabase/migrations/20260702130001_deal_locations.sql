-- M4: live location for co-location detection. One latest ping per (deal, user).
-- Privacy: there are intentionally NO client read/write policies — only the server
-- (service_role, which bypasses RLS) touches this table. A party never sees the
-- other's raw coordinates; the API returns only the distance-between and the
-- resulting state.
create table public.deal_locations (
  deal_id    uuid not null references public.deals(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);

alter table public.deal_locations enable row level security;
-- RLS on + no policy = clients cannot read or write this table at all.

grant all on public.deal_locations to service_role;
