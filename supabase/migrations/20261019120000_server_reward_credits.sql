-- Server-issued reward credits for Strava runs and in-app GPS runs.
--
-- Rules (enforced here, not in the app):
--   * A qualifying run earns at most one credit: unique (source, source_ref).
--   * One active credit per runner: every minting path takes a per-user advisory lock and
--     refuses while an unredeemed, unexpired credit exists.
--   * expires_at is exactly unlocked_at + 1 hour (check constraint).
--   * Selecting a store does not redeem; a credit is redeemed once, at the selected store.
--   * Strava: only runs that started after Strava was connected and are seen within 3 hours
--     of finishing earn a credit; a run finished while another credit is active is
--     permanently recorded as not earning (reward_decision), so it never pays out later.
--   * Clients can read their own credits; all changes go through the functions below.

-- 1. Activity fields for reward decisions ------------------------------------------------
alter table public.strava_activities
  add column elapsed_time_s     integer,
  add column reward_decision    text
    check (reward_decision in ('earned', 'active_reward', 'not_recent')),
  add column reward_decided_at  timestamptz;

-- record_strava_activities now also stores elapsed time (used to know when a run finished).
create or replace function public.record_strava_activities(
  p_user_id    uuid,
  p_athlete_id bigint,
  p_activities jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with incoming as (
    select *
    from jsonb_to_recordset(p_activities) as a(
      activity_id    bigint,
      name           text,
      sport_type     text,
      distance_m     double precision,
      moving_time_s  integer,
      elapsed_time_s integer,
      start_date     timestamptz,
      is_manual      boolean,
      qualifies      boolean
    )
  ),
  written as (
    insert into public.strava_activities as existing (
      activity_id, user_id, athlete_id, name, sport_type, distance_m,
      moving_time_s, elapsed_time_s, start_date, is_manual, qualifies
    )
    select distinct on (activity_id)
      activity_id, p_user_id, p_athlete_id, name, sport_type, distance_m,
      moving_time_s, elapsed_time_s, start_date, coalesce(is_manual, true), coalesce(qualifies, false)
    from incoming
    order by activity_id
    on conflict (activity_id) do update
      set name           = excluded.name,
          sport_type     = excluded.sport_type,
          distance_m     = excluded.distance_m,
          moving_time_s  = excluded.moving_time_s,
          elapsed_time_s = excluded.elapsed_time_s,
          start_date     = excluded.start_date,
          is_manual      = excluded.is_manual,
          qualifies      = excluded.qualifies,
          deleted_at     = null,
          updated_at     = now()
      where existing.athlete_id = excluded.athlete_id
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke all on function public.record_strava_activities(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.record_strava_activities(uuid, bigint, jsonb) to service_role;

-- 2. Reward credits ------------------------------------------------------------------------
create table public.reward_credits (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  source             text not null check (source in ('strava', 'gps')),
  source_ref         text not null,
  unlocked_at        timestamptz not null default now(),
  expires_at         timestamptz not null,
  selected_store_id  text,
  redeemed_at        timestamptz,
  redeemed_store_id  text,
  constraint reward_credits_one_per_run unique (source, source_ref),
  constraint reward_credits_one_hour check (expires_at = unlocked_at + interval '1 hour'),
  constraint reward_credits_redeemed_pair check ((redeemed_at is null) = (redeemed_store_id is null)),
  constraint reward_credits_redeemed_at_selected
    check (redeemed_store_id is null or redeemed_store_id = selected_store_id),
  constraint reward_credits_store_id_format
    check (selected_store_id is null or selected_store_id ~ '^[a-z0-9-]{1,64}$')
);

create index reward_credits_user_unlocked_idx on public.reward_credits (user_id, unlocked_at desc);

alter table public.reward_credits enable row level security;
revoke all on table public.reward_credits from anon, authenticated;
grant select on table public.reward_credits to authenticated;
grant select, insert, update, delete on table public.reward_credits to service_role;

create policy "Runners can read their own reward credits"
  on public.reward_credits
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 3. Internal helpers (not callable by clients) ---------------------------------------------
create function public.lock_reward_credits(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('reward_credits:' || p_user_id::text, 0));
end;
$$;

create function public.has_active_reward(p_user_id uuid, p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.reward_credits
    where user_id = p_user_id and redeemed_at is null and expires_at > p_now
  );
$$;

revoke all on function public.lock_reward_credits(uuid) from public, anon, authenticated;
revoke all on function public.has_active_reward(uuid, timestamptz) from public, anon, authenticated;
-- evaluate_strava_rewards runs as service_role and needs these.
grant execute on function public.lock_reward_credits(uuid) to service_role;
grant execute on function public.has_active_reward(uuid, timestamptz) to service_role;

-- 4. Strava: decide rewards for newly recorded activities (called by Edge Functions) --------
-- Non-qualifying activities stay undecided, so a later type correction can still be judged
-- (recency still applies). Every decision on a qualifying activity is final.
create function public.evaluate_strava_rewards(
  p_user_id       uuid,
  p_now           timestamptz default now(),
  p_recent_window interval default interval '3 hours'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connected_at timestamptz;
  v_activity     record;
  v_finished_at  timestamptz;
  v_decision     text;
  v_earned       integer := 0;
begin
  perform public.lock_reward_credits(p_user_id);

  select connected_at into v_connected_at
  from public.strava_connections
  where user_id = p_user_id and status = 'connected';

  for v_activity in
    select activity_id, start_date, elapsed_time_s, moving_time_s
    from public.strava_activities
    where user_id = p_user_id
      and reward_decision is null
      and deleted_at is null
      and qualifies
    order by start_date asc nulls last, activity_id asc
    for update
  loop
    v_finished_at := v_activity.start_date
      + make_interval(secs => coalesce(v_activity.elapsed_time_s, v_activity.moving_time_s, 0));

    if v_connected_at is null
       or v_activity.start_date is null
       or v_activity.start_date < v_connected_at
       or v_finished_at < p_now - p_recent_window then
      v_decision := 'not_recent';
    elsif public.has_active_reward(p_user_id, p_now) then
      v_decision := 'active_reward';
    else
      insert into public.reward_credits (user_id, source, source_ref, unlocked_at, expires_at)
      values (p_user_id, 'strava', v_activity.activity_id::text, p_now, p_now + interval '1 hour')
      on conflict (source, source_ref) do nothing;
      v_decision := 'earned';
      v_earned := v_earned + 1;
    end if;

    update public.strava_activities
    set reward_decision = v_decision, reward_decided_at = p_now
    where activity_id = v_activity.activity_id;
  end loop;

  return v_earned;
end;
$$;

revoke all on function public.evaluate_strava_rewards(uuid, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.evaluate_strava_rewards(uuid, timestamptz, interval) to service_role;

-- 5. Strava disconnect: keep ids, dates and reward decisions; erase other details -----------
create function public.scrub_strava_activities(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.strava_activities
  set name = null, sport_type = null, moving_time_s = null, elapsed_time_s = null,
      updated_at = now()
  where user_id = p_user_id;
$$;

revoke all on function public.scrub_strava_activities(uuid) from public, anon, authenticated;
grant execute on function public.scrub_strava_activities(uuid) to service_role;

-- 6. In-app GPS runs: claim a credit (client-reported, sanity-checked) ----------------------
-- The distance comes from the phone and cannot be verified; these checks only reject
-- impossible claims. Returns 'earned', 'already_earned' or 'active_reward'.
create function public.claim_gps_reward(
  p_run_id     text,
  p_distance_m double precision,
  p_started_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now  timestamptz := now();
  v_ref  text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- The app's run id is the run's start time in epoch milliseconds.
  if p_run_id is null or p_run_id !~ '^[0-9]{12,16}$'
     or p_started_at is null
     or abs(extract(epoch from p_started_at) * 1000 - p_run_id::numeric) > 1000 then
    raise exception 'invalid_run' using errcode = '22023';
  end if;
  if p_distance_m is null or p_distance_m < 5000 or p_distance_m > 100000 then
    raise exception 'not_qualifying' using errcode = '22023';
  end if;
  if p_started_at > v_now + interval '5 minutes' or p_started_at < v_now - interval '12 hours' then
    raise exception 'not_recent' using errcode = '22023';
  end if;
  -- Nobody averages faster than 6 m/s (about 2:47 per km) over 5 km+.
  if extract(epoch from (v_now - p_started_at)) < p_distance_m / 6.0 then
    raise exception 'implausible_pace' using errcode = '22023';
  end if;

  v_ref := v_user::text || ':' || p_run_id;
  perform public.lock_reward_credits(v_user);

  if exists (select 1 from public.reward_credits where source = 'gps' and source_ref = v_ref) then
    return 'already_earned';
  end if;
  if public.has_active_reward(v_user, v_now) then
    return 'active_reward';
  end if;

  insert into public.reward_credits (user_id, source, source_ref, unlocked_at, expires_at)
  values (v_user, 'gps', v_ref, v_now, v_now + interval '1 hour');
  return 'earned';
end;
$$;

-- 7. Store selection and redemption (the runner's own credit only) --------------------------
create function public.select_reward_store(p_credit_id uuid, p_store_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_credit public.reward_credits%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_store_id is null or p_store_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'invalid_store' using errcode = '22023';
  end if;

  perform public.lock_reward_credits(v_user);
  select * into v_credit from public.reward_credits
  where id = p_credit_id and user_id = v_user
  for update;

  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if v_credit.redeemed_at is not null then raise exception 'already_redeemed' using errcode = '22023'; end if;
  if v_credit.expires_at <= now() then raise exception 'expired' using errcode = '22023'; end if;
  if v_credit.selected_store_id is not null then
    if v_credit.selected_store_id = p_store_id then return 'selected'; end if;
    raise exception 'store_already_selected' using errcode = '22023';
  end if;

  update public.reward_credits set selected_store_id = p_store_id where id = p_credit_id;
  return 'selected';
end;
$$;

create function public.redeem_reward(p_credit_id uuid, p_store_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_credit public.reward_credits%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  perform public.lock_reward_credits(v_user);
  select * into v_credit from public.reward_credits
  where id = p_credit_id and user_id = v_user
  for update;

  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if v_credit.redeemed_at is not null then raise exception 'already_redeemed' using errcode = '22023'; end if;
  if v_credit.expires_at <= now() then raise exception 'expired' using errcode = '22023'; end if;
  if v_credit.selected_store_id is distinct from p_store_id then
    raise exception 'wrong_store' using errcode = '22023';
  end if;

  update public.reward_credits
  set redeemed_at = now(), redeemed_store_id = p_store_id
  where id = p_credit_id;
  return 'redeemed';
end;
$$;

revoke all on function public.claim_gps_reward(text, double precision, timestamptz) from public, anon;
revoke all on function public.select_reward_store(uuid, text) from public, anon;
revoke all on function public.redeem_reward(uuid, text) from public, anon;
grant execute on function public.claim_gps_reward(text, double precision, timestamptz) to authenticated;
grant execute on function public.select_reward_store(uuid, text) to authenticated;
grant execute on function public.redeem_reward(uuid, text) to authenticated;
