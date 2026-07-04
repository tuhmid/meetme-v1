-- Safety: block a user (no future deals between you) and report bad actors for review.
-- Server-only (service_role); no client policies — all access goes through the API.
create table public.blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index on public.blocks (blocked_id);
alter table public.blocks enable row level security;
grant all on public.blocks to service_role;

create table public.reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references public.users(id),
  reported_id uuid not null references public.users(id),
  deal_id     uuid references public.deals(id) on delete set null,
  reason      text not null,
  status      text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at  timestamptz not null default now()
);
create index on public.reports (reported_id);
create index on public.reports (status);
alter table public.reports enable row level security;
grant all on public.reports to service_role;
