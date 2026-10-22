-- Push notifications: device push tokens and "notified once" markers.
--
-- * push_tokens: server-only (RLS on, no client grants). Devices register/unregister their
--   own token through the two functions below, which use auth.uid().
-- * reward_credits.unlock_notified_at: set once the "reward unlocked" push has been handled,
--   so webhook retries and re-syncs never notify twice.

create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_tokens_expo_format
    check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$')
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
revoke all on table public.push_tokens from anon, authenticated;
grant select, insert, update, delete on table public.push_tokens to service_role;

alter table public.reward_credits add column unlock_notified_at timestamptz;

-- A device registers its token for the signed-in runner. A token moves to whoever signed in
-- on that device most recently, so a shared phone never notifies the previous account.
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid_platform' using errcode = '22023';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (p_token, v_user, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();

  -- Keep at most 10 devices per runner (oldest dropped).
  delete from public.push_tokens
  where user_id = v_user
    and token not in (
      select token from public.push_tokens
      where user_id = v_user
      order by updated_at desc
      limit 10
    );
end;
$$;

-- Called before signing out, so a signed-out device stops receiving that runner's pushes.
create function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
