-- Frictionless seller commitment: the seller no longer stakes $5 into escrow
-- (POST_STAKE is gone — the buyer's FUND arms the deal). Instead the seller keeps
-- a card on file ($0 validation, required to accept terms); a commitment hold is
-- placed when they head out and captured only on a no-show — routed to the
-- stood-up party, not the company. No apply_transition change: the new side-effect
-- kinds (hold/capture/release) are executed by the server against the payment
-- rail, and unknown kinds already fall through the RPC's effect loop untouched.
alter table public.users
  add column if not exists has_card_on_file boolean not null default false,
  add column if not exists card_last4       text;

alter table public.deals
  add column if not exists seller_hold_id text;  -- the rail's reference for the active commitment hold
