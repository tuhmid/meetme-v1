-- M8: persist disputes + dispute positions. apply_transition now handles three new
-- side-effects (dispute_opened / dispute_position / dispute_resolved) by writing to
-- the disputes + dispute_positions tables (created in 0001). Re-creates the function
-- with the added effect branches; everything else is unchanged from 0009.
create or replace function public.apply_transition(
  p_deal_id          uuid,
  p_expected_version int,
  p_deal             jsonb,
  p_events           jsonb,
  p_ledger           jsonb,
  p_effects          jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current int;
  e jsonb;
begin
  select version into v_current from public.deals where id = p_deal_id for update;
  if v_current is null then raise exception 'deal not found: %', p_deal_id; end if;
  if v_current <> p_expected_version then
    raise exception 'version conflict' using errcode = '40001';
  end if;

  update public.deals set
    state                = (p_deal->>'state')::deal_state,
    release_code_hash    = p_deal->>'releaseCodeHash',
    code_revealed        = coalesce((p_deal->>'codeRevealed')::boolean, false),
    buyer_headed_out_at  = case when (p_deal->>'buyerHeadedOut')::boolean  and buyer_headed_out_at  is null then now() else buyer_headed_out_at  end,
    seller_headed_out_at = case when (p_deal->>'sellerHeadedOut')::boolean and seller_headed_out_at is null then now() else seller_headed_out_at end,
    buyer_arrived_at     = case when (p_deal->>'buyerArrived')::boolean  and buyer_arrived_at  is null then now() else buyer_arrived_at  end,
    seller_arrived_at    = case when (p_deal->>'sellerArrived')::boolean and seller_arrived_at is null then now() else seller_arrived_at end,
    fault_party          = p_deal->>'faultParty',
    resolution_note      = p_deal->>'resolutionNote',
    version              = version + 1
  where id = p_deal_id;

  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    insert into public.deal_events(deal_id, actor, type, note)
    values (p_deal_id, e->>'actor', e->>'type', e->>'note');
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_ledger, '[]'::jsonb)) loop
    insert into public.ledger_entries(txn_id, account, amount_cents, deal_id, memo)
    values (e->>'txnId', e->>'account', (e->>'amountCents')::bigint, p_deal_id, e->>'memo');
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    if e->>'type' = 'deal_completed' then
      update public.users set completed_deals = completed_deals + 1
        where id in (select (jsonb_array_elements_text(e->'userIds'))::uuid);
    elsif e->>'type' = 'trust_delta' then
      update public.users set trust_score = greatest(0, least(100, trust_score + (e->>'delta')::int))
        where id = (e->>'userId')::uuid;
    elsif e->>'type' = 'rating' then
      insert into public.ratings(deal_id, rater_id, ratee_id, stars)
        values (p_deal_id, (e->>'raterId')::uuid, (e->>'rateeId')::uuid, (e->>'stars')::int)
        on conflict (deal_id, rater_id) do nothing;
      update public.users u
        set trust_score = greatest(0, least(100, (select round(avg(stars) / 5.0 * 100) from public.ratings where ratee_id = (e->>'rateeId')::uuid)))
        where u.id = (e->>'rateeId')::uuid;
    elsif e->>'type' = 'dispute_opened' then
      insert into public.disputes(deal_id, opened_by, status)
        values (p_deal_id, (e->>'byUserId')::uuid, 'open');
    elsif e->>'type' = 'dispute_position' then
      insert into public.dispute_positions(dispute_id, actor, text)
        select id, e->>'actor', e->>'text'
        from public.disputes where deal_id = p_deal_id and status <> 'resolved'
        order by created_at desc limit 1;
    elsif e->>'type' = 'dispute_resolved' then
      update public.disputes
        set status = 'resolved', resolution = e->>'outcome', resolved_by = 'admin', resolved_at = now()
        where deal_id = p_deal_id and status <> 'resolved';
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_transition(uuid, int, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_transition(uuid, int, jsonb, jsonb, jsonb, jsonb) to service_role;
