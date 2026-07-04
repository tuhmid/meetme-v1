-- MeetMe v1 — schema (M1). Money in integer cents (bigint). Server generates IDs.
create extension if not exists pgcrypto;

create type deal_state as enum (
  'DRAFT','AGREED','FUNDED','ARMED','EN_ROUTE','AT_MEETUP','CONFIRMING',
  'RELEASED','DISPUTED','CANCELLED','REFUNDED','EXPIRED_NO_SHOW','DISPUTE_RESOLVED'
);

-- Profile row, keyed to Supabase auth.users(id) in the live project.
create table public.users (
  id              uuid primary key default gen_random_uuid(),
  phone           text unique not null,            -- one account per phone (sybil control)
  phone_is_voip   boolean not null default false,
  name            text not null,
  avatar_color    text not null default '#2f6f5e',
  identity_tier   text not null default 'phone'  check (identity_tier in ('phone','id_verified')),
  kyc_status      text not null default 'none'   check (kyc_status in ('none','pending','verified','rejected')),
  kyc_ref         text,
  trust_score     int  not null default 50       check (trust_score between 0 and 100),
  completed_deals int  not null default 0,
  accepted_terms_at timestamptz,                  -- prohibited-items agree-to-terms gate
  created_at      timestamptz not null default now()
);

create table public.payment_methods (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  plaid_item_id    text not null,                 -- tokens only; never raw account numbers
  plaid_account_id text not null,
  institution_name text,
  mask             text,
  subtype          text,
  is_default_payout boolean not null default false,
  status           text not null default 'active' check (status in ('active','reauth_required','removed')),
  verified_at      timestamptz,
  created_at       timestamptz not null default now()
);

create table public.deals (
  id                 uuid primary key default gen_random_uuid(),
  created_by         uuid not null references public.users(id),
  buyer_id           uuid not null references public.users(id),
  seller_id          uuid not null references public.users(id),
  use_case           text not null default 'marketplace',
  item_description   text not null,
  amount_cents       bigint not null check (amount_cents > 0),
  fee_cents_per_side bigint not null check (fee_cents_per_side >= 0),
  commitment_cents   bigint not null check (commitment_cents >= 0),
  state              deal_state not null default 'DRAFT',
  release_code_hash  text,                         -- hash only; plaintext never stored
  code_revealed      boolean not null default false,
  buyer_arrived_at   timestamptz,
  seller_arrived_at  timestamptz,
  fault_party        text check (fault_party in ('buyer','seller')),
  resolution_note    text,
  version            int not null default 0,       -- optimistic lock
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create index on public.deals (buyer_id);
create index on public.deals (seller_id);

create table public.deal_events (
  id      bigint generated always as identity primary key,
  deal_id uuid not null references public.deals(id) on delete cascade,
  actor   text not null check (actor in ('buyer','seller','system')),
  type    text not null,
  note    text not null,
  at      timestamptz not null default now()
);
create index on public.deal_events (deal_id);

-- Double-entry ledger. Money inside the system = escrow + platform balances.
create table public.ledger_entries (
  id           bigint generated always as identity primary key,
  txn_id       text not null,
  account      text not null,                      -- 'escrow:<dealId>' | 'bank:<userId>' | 'platform:fees' | 'platform:penalty'
  amount_cents bigint not null,                    -- signed; per txn_id sums to 0
  deal_id      uuid references public.deals(id),
  memo         text not null,
  created_at   timestamptz not null default now()
);
create index on public.ledger_entries (txn_id);
create index on public.ledger_entries (account);
create index on public.ledger_entries (deal_id);

create table public.transfers (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.deals(id),
  provider        text not null,
  provider_ref    text,
  rail            text check (rail in ('rtp','fednow','ach','card')),
  direction       text not null check (direction in ('fund_buyer','payout_seller','refund_buyer','fee_capture')),
  amount_cents    bigint not null,
  status          text not null default 'pending' check (status in ('pending','processing','settled','returned','failed')),
  risk_score      numeric,
  idempotency_key text unique not null,            -- no double-charge
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create table public.disputes (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id),
  opened_by   uuid not null references public.users(id),
  status      text not null default 'open' check (status in ('open','self_resolving','escalated','resolved')),
  resolution  text check (resolution in ('release','refund','split')),
  resolved_by text check (resolved_by in ('auto','user_agreement','admin')),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create table public.dispute_positions (
  id         bigint generated always as identity primary key,
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  actor      text not null check (actor in ('buyer','seller')),
  text       text not null,
  evidence   jsonb,
  at         timestamptz not null default now()
);

create table public.ratings (
  id         bigint generated always as identity primary key,
  deal_id    uuid not null references public.deals(id),
  rater_id   uuid not null references public.users(id),
  ratee_id   uuid not null references public.users(id),
  stars      int not null check (stars between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  unique (deal_id, rater_id)
);

create table public.safe_spots (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  address text,
  lat     double precision,
  lng     double precision,
  type    text check (type in ('police','transit','bank','public')),
  created_at timestamptz not null default now()
);

create table public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  expo_token text not null,
  platform   text,
  created_at timestamptz not null default now(),
  unique (user_id, expo_token)
);

-- Counterparty-safe profile (NO phone / kyc / terms) for showing the other party.
create view public.public_profiles as
  select id, name, avatar_color, identity_tier, trust_score, completed_deals
  from public.users;
