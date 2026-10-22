-- PostgREST upserts (on conflict do update) set every column in the request, including the
-- primary key, so saving a profile needs UPDATE on user_id too. This can't move a row to
-- someone else: the "profiles: update own" policy requires user_id = auth.uid() afterwards.
grant update (user_id) on table public.profiles to authenticated;
