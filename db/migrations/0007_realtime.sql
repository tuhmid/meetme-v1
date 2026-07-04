-- M4: stream deal / transfer / event changes to the two participants' phones via
-- Supabase Realtime (postgres_changes). RLS already scopes these tables to the
-- parties, so a subscriber only receives rows they're allowed to read. Idempotent
-- so it's safe across resets and re-runs.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['deals', 'transfers', 'deal_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
