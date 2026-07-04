-- Table/sequence privileges. Clients (anon/authenticated) remain gated by RLS
-- (these grants just let the policies apply); the server uses service_role, which
-- also bypasses RLS. Functions are granted to service_role only — apply_transition
-- stays off-limits to clients (the 0004 revoke from anon/authenticated stands).
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to service_role;
