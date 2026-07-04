-- Defense in depth: the database itself refuses an unbalanced ledger transaction.
-- Deferred so it checks at COMMIT, after all legs of a txn are inserted.

create or replace function public.assert_txn_balanced() returns trigger
language plpgsql as $$
begin
  if (select coalesce(sum(amount_cents), 0) from public.ledger_entries where txn_id = new.txn_id) <> 0 then
    raise exception 'ledger txn % is not balanced (legs must sum to 0)', new.txn_id;
  end if;
  return null;
end;
$$;

create constraint trigger ledger_txn_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.assert_txn_balanced();

-- updated_at maintenance on deals
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger deals_touch_updated_at before update on public.deals
  for each row execute function public.touch_updated_at();
