-- Chat images: a message can carry a photo (item pics, "I'm in the blue jacket",
-- receipts). The image lives in a PRIVATE Storage bucket; messages stores only its
-- path (served to clients via short-lived signed URLs). body becomes optional — a
-- message is text, an image, or both.
alter table public.messages add column if not exists image_path text;
alter table public.messages alter column body drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_body_or_image') then
    alter table public.messages
      add constraint messages_body_or_image check (body is not null or image_path is not null);
  end if;
end $$;

-- Private bucket for deal media (never public; the API mints signed URLs on read).
insert into storage.buckets (id, name, public)
  values ('deal-media', 'deal-media', false)
  on conflict (id) do nothing;
