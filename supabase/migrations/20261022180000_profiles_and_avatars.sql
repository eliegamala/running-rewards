-- Runner profiles saved to the account: display name and profile photo.
--
-- * profiles: one row per runner; they can read and write only their own row (RLS).
-- * avatars: a private Storage bucket. Each runner can only touch files in their own
--   folder (<user id>/avatar-<epoch ms>.jpg). Photos are read through short-lived signed
--   URLs, never public links. Files don't cascade with the user, so the delete-account
--   function removes them before deleting the account.

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 30),
  avatar_path  text,
  updated_at   timestamptz not null default now(),
  constraint profiles_avatar_path_own_folder
    check (avatar_path is null or avatar_path ~ ('^' || user_id::text || '/avatar-[0-9]{13}\.jpg$'))
);

create function public.touch_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (user_id, display_name, avatar_path) on table public.profiles to authenticated;
grant update (display_name, avatar_path) on table public.profiles to authenticated;
grant select, delete on table public.profiles to service_role;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles: create own" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private bucket: small JPEGs only (the app resizes to 512 px before uploading).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/jpeg'])
on conflict (id) do nothing;

create policy "avatars: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "avatars: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
