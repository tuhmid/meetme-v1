-- Add the payout_buyer transfer direction: a FORWARD transfer to the buyer (the
-- seller's captured deposit on a no-show), distinct from refund_buyer which reverses
-- the buyer's own charge. Fixes the no-show compensation being mislabeled a refund.
alter table public.transfers drop constraint if exists transfers_direction_check;
alter table public.transfers add constraint transfers_direction_check
  check (direction in ('fund_buyer', 'payout_seller', 'refund_buyer', 'payout_buyer', 'fee_capture'));
