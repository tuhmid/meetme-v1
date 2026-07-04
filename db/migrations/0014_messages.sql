-- In-deal chat. Participants coordinate the handoff ("blue jacket, running 5 min late").
-- Messages are readable by the two parties (RLS) so real-login clients can subscribe
-- via Realtime; sends go through the server (service_role). Text-only for now.
create table public.messages (
  id         bigint generated always as identity primary key,
  deal_id    uuid not null references public.deals(id) on delete cascade,
  sender_id  uuid not null references public.users(id),
  body       text not null,
  created_at timestamptz not null default now()
);
create index on public.messages (deal_id, created_at);

alter table public.messages enable row level security;

-- participants can READ their deal's messages (enables RLS-scoped Realtime delivery)
create policy messages_read on public.messages
  for select using (exists (select 1 from public.deals d where d.id = deal_id and auth.uid() in (d.buyer_id, d.seller_id)));
-- no client INSERT policy: sends go through the API (service_role). Add one later if
-- we want client-direct sends.

grant all on public.messages to service_role;
grant select on public.messages to anon, authenticated;

-- stream messages to the two phones
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;
