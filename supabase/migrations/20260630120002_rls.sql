-- Row-Level Security. Principle: clients READ only what they're party to and
-- NEVER the counterparty's private data; clients NEVER write money tables. All
-- mutations go through the server (service role, which bypasses RLS) running the
-- @meetme/server transition handler. auth.uid() is the Supabase-authed user.

alter table public.users            enable row level security;
alter table public.payment_methods  enable row level security;
alter table public.deals            enable row level security;
alter table public.deal_events      enable row level security;
alter table public.ledger_entries   enable row level security;
alter table public.transfers        enable row level security;
alter table public.disputes         enable row level security;
alter table public.dispute_positions enable row level security;
alter table public.ratings          enable row level security;
alter table public.safe_spots       enable row level security;
alter table public.push_tokens      enable row level security;

-- users: only your OWN full row (phone/kyc are private). Counterparty data is
-- read via public_profiles (security_invoker view) instead.
create policy users_self_read on public.users
  for select using (id = auth.uid());

-- payment_methods: manage your own only.
create policy pm_self on public.payment_methods
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- helper: is the current user a party to a deal?
create or replace function public.is_party(d public.deals) returns boolean
  language sql stable as $$ select auth.uid() in (d.buyer_id, d.seller_id) $$;

-- deals: read your own; no client writes (server/service role only).
create policy deals_party_read on public.deals
  for select using (auth.uid() in (buyer_id, seller_id));

-- child tables: readable when you're party to the parent deal; no client writes.
create policy events_read on public.deal_events
  for select using (exists (select 1 from public.deals d where d.id = deal_id and auth.uid() in (d.buyer_id, d.seller_id)));
create policy ledger_read on public.ledger_entries
  for select using (exists (select 1 from public.deals d where d.id = deal_id and auth.uid() in (d.buyer_id, d.seller_id)));
create policy transfers_read on public.transfers
  for select using (exists (select 1 from public.deals d where d.id = deal_id and auth.uid() in (d.buyer_id, d.seller_id)));
create policy disputes_read on public.disputes
  for select using (exists (select 1 from public.deals d where d.id = deal_id and auth.uid() in (d.buyer_id, d.seller_id)));
create policy dispute_pos_read on public.dispute_positions
  for select using (exists (select 1 from public.disputes x join public.deals d on d.id = x.deal_id where x.id = dispute_id and auth.uid() in (d.buyer_id, d.seller_id)));
create policy ratings_read on public.ratings
  for select using (exists (select 1 from public.deals d where d.id = deal_id and auth.uid() in (d.buyer_id, d.seller_id)));

-- safe spots: readable by any authenticated user.
create policy safe_spots_read on public.safe_spots for select using (auth.role() = 'authenticated');

-- push tokens: manage your own.
create policy push_self on public.push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- public_profiles view runs with the invoker's rights but exposes only safe
-- columns; grant select to authenticated.
alter view public.public_profiles set (security_invoker = true);
grant select on public.public_profiles to authenticated;

-- NOTE: no INSERT/UPDATE/DELETE policies on deals / deal_events / ledger_entries /
-- transfers / disputes / dispute_positions / ratings. With RLS on and no write
-- policy, clients cannot write them at all. The server uses the service role.
