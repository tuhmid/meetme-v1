-- M6: invites. A user can invite someone to a deal BY PHONE before that person is
-- registered. When the invitee signs in and accepts, the real deal is created
-- (inviter = buyer, accepter = seller). Server-only (service_role); no client RLS
-- policies (all invite access goes through the API).
create table public.invites (
  token            text primary key,
  inviter_id       uuid not null references public.users(id) on delete cascade,
  inviter_role     text not null default 'buyer' check (inviter_role in ('buyer','seller')),
  invitee_phone    text not null,                 -- digits only
  item_description text not null,
  amount_cents     bigint not null check (amount_cents > 0),
  status           text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  deal_id          uuid references public.deals(id) on delete set null,
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz
);
create index on public.invites (invitee_phone);
create index on public.invites (inviter_id);

alter table public.invites enable row level security;
grant all on public.invites to service_role;
