-- Only the runner's single most recent run can ever unlock a reward.
--
-- * Strava: of the undecided qualifying activities, only the newest is judged; every older
--   one is recorded as 'not_recent' (it is never "the run you just finished"). An activity
--   that finished before one already judged, or before a later in-app run, is not_recent too.
-- * The same run tracked in the app and also uploaded to Strava earns once: the Strava copy
--   is recorded as 'same_run', and a late in-app claim for a run Strava already rewarded
--   returns 'already_earned'.

alter table public.strava_activities drop constraint strava_activities_reward_decision_check;
alter table public.strava_activities
  add constraint strava_activities_reward_decision_check
    check (reward_decision in ('earned', 'active_reward', 'not_recent', 'same_run'));

-- In-app run start from a GPS credit's source_ref "<user id>:<start epoch ms>"; null if the
-- reference isn't in that form (never raises, so one odd row can't break reward checks).
create function public.gps_run_started_at(p_source_ref text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source_ref ~ '^[0-9a-fA-F-]{36}:[0-9]{12,16}$'
      then to_timestamp(split_part(p_source_ref, ':', 2)::bigint / 1000.0)
  end
$$;

revoke all on function public.gps_run_started_at(text) from public, anon, authenticated;
grant execute on function public.gps_run_started_at(text) to service_role;

create or replace function public.evaluate_strava_rewards(
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
  v_connected_at   timestamptz;
  v_latest         record;
  v_finished_at    timestamptz;
  v_newest_decided timestamptz;
  v_decision       text;
begin
  perform public.lock_reward_credits(p_user_id);

  select connected_at into v_connected_at
  from public.strava_connections
  where user_id = p_user_id and status = 'connected';

  -- The newest undecided qualifying activity is the only candidate.
  select activity_id, start_date,
         start_date + make_interval(secs => coalesce(elapsed_time_s, moving_time_s, 0)) as finished_at
  into v_latest
  from public.strava_activities
  where user_id = p_user_id and reward_decision is null and deleted_at is null and qualifies
  order by start_date + make_interval(secs => coalesce(elapsed_time_s, moving_time_s, 0)) desc nulls last,
           activity_id desc
  limit 1
  for update;

  if not found then return 0; end if;
  v_finished_at := v_latest.finished_at;

  -- Everything older is never "the run you just finished".
  update public.strava_activities
  set reward_decision = 'not_recent', reward_decided_at = p_now
  where user_id = p_user_id and reward_decision is null and deleted_at is null and qualifies
    and activity_id <> v_latest.activity_id;

  select max(start_date + make_interval(secs => coalesce(elapsed_time_s, moving_time_s, 0)))
  into v_newest_decided
  from public.strava_activities
  where user_id = p_user_id and reward_decision is not null and activity_id <> v_latest.activity_id;

  if v_connected_at is null
     or v_latest.start_date is null
     or v_latest.start_date < v_connected_at
     or v_finished_at < p_now - p_recent_window
     or (v_newest_decided is not null and v_finished_at <= v_newest_decided)
     -- A later in-app run exists, so this one isn't the most recent.
     or exists (
       select 1 from public.reward_credits c
       where c.user_id = p_user_id and c.source = 'gps'
         and public.gps_run_started_at(c.source_ref) > v_finished_at
     ) then
    v_decision := 'not_recent';
  -- The same run, already rewarded from the in-app tracker.
  elsif exists (
    select 1 from public.reward_credits c
    where c.user_id = p_user_id and c.source = 'gps'
      and public.gps_run_started_at(c.source_ref)
          between v_latest.start_date - interval '15 minutes' and v_finished_at
  ) then
    v_decision := 'same_run';
  elsif public.has_active_reward(p_user_id, p_now) then
    v_decision := 'active_reward';
  else
    insert into public.reward_credits (user_id, source, source_ref, unlocked_at, expires_at)
    values (p_user_id, 'strava', v_latest.activity_id::text, p_now, p_now + interval '1 hour')
    on conflict (source, source_ref) do nothing;
    v_decision := 'earned';
  end if;

  update public.strava_activities
  set reward_decision = v_decision, reward_decided_at = p_now
  where activity_id = v_latest.activity_id;

  return case when v_decision = 'earned' then 1 else 0 end;
end;
$$;

create or replace function public.claim_gps_reward(
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
  -- Strava already rewarded this same run (e.g. this claim was queued while offline).
  if exists (
    select 1 from public.strava_activities a
    where a.user_id = v_user and a.reward_decision = 'earned'
      and a.start_date between p_started_at - interval '15 minutes' and p_started_at + interval '15 minutes'
  ) then
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
