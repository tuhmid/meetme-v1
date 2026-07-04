-- M5: link real Supabase Auth (phone OTP) to profiles. When an auth user is
-- created, mirror a public.users row keyed to auth.users(id) so RLS's auth.uid()
-- equals users.id. Name comes from signup metadata; accepting terms is implied at
-- signup (prohibited-items policy). There is intentionally NO hard FK from
-- public.users.id to auth.users(id), so dev/test users (server-minted, no auth
-- row) still work — both paths coexist. `on conflict do nothing` tolerates a
-- pre-existing row (e.g. a demo phone), so it never blocks auth signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone, name, accepted_terms_at)
  values (
    new.id,
    coalesce(new.phone, new.id::text),
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), 'MeetMe user'),
    now()
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
