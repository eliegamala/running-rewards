-- In-app GPS runs: the server measures the route itself.
--
-- Before, the app sent only "this run was N metres" and the server trusted the number. Now,
-- when a run passes 5 km, the app uploads the GPS points it measured and the server works out
-- the distance from them, with the same filtering the app uses (src/lib/run-tracker.ts):
--   * fixes less precise than 25 m are ignored;
--   * moves under 3 m are GPS jitter and don't count (the last point stays put);
--   * a jump faster than 10 m/s is a GPS glitch and doesn't count;
--   * distance is never counted across a pause (each pause starts a new segment).
-- A run is also rejected outright when:
--   * Android flagged any point as coming from a mock-location app ('mocked_location');
--   * the counted distance was covered faster than 6 m/s on average ('implausible_route');
--   * points are from before the run started or from the future ('invalid_route').
-- The newest-run-only rules (20261022235000_latest_run_only.sql) are unchanged: credits keep
-- the source_ref "<user id>:<start epoch ms>" that those rules read.

-- 1. Route points -------------------------------------------------------------------------
-- Kept after the claim so a disputed reward can be reviewed. Deleted with the account.
create table public.gps_run_points (
  user_id     uuid not null references auth.users (id) on delete cascade,
  run_id      text not null,
  seq         integer not null check (seq >= 0 and seq < 20000),
  segment     integer not null check (segment >= 0 and segment < 1000),
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  accuracy_m  double precision check (accuracy_m >= 0),
  recorded_at timestamptz not null,
  mocked      boolean not null default false,
  received_at timestamptz not null default now(),
  primary key (user_id, run_id, seq)
);

alter table public.gps_run_points enable row level security;
revoke all on table public.gps_run_points from anon, authenticated;
grant select, insert, update, delete on table public.gps_run_points to service_role;

-- 2. Shared checks ----------------------------------------------------------------------------
-- The app's run id is the run's start time in epoch milliseconds. Raises 'invalid_run' unless
-- it is in that form; raises 'not_recent' unless the run started in the last 12 hours.
create function public.gps_run_start(p_run_id text, p_now timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_started timestamptz;
begin
  if p_run_id is null or p_run_id !~ '^[0-9]{12,16}$' then
    raise exception 'invalid_run' using errcode = '22023';
  end if;
  v_started := to_timestamp(p_run_id::bigint / 1000.0);
  if v_started > p_now + interval '5 minutes' or v_started < p_now - interval '12 hours' then
    raise exception 'not_recent' using errcode = '22023';
  end if;
  return v_started;
end;
$$;

revoke all on function public.gps_run_start(text, timestamptz) from public, anon, authenticated;

-- Haversine distance in metres; the same formula and Earth radius as the app.
create function public.gps_distance_m(
  p_lat1 double precision, p_lon1 double precision,
  p_lat2 double precision, p_lon2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians(p_lat2 - p_lat1) / 2) ^ 2
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * sin(radians(p_lon2 - p_lon1) / 2) ^ 2
  ))
$$;

revoke all on function public.gps_distance_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- 3. Upload --------------------------------------------------------------------------------------
-- Stores up to 500 points of one of the caller's runs. Safe to retry: a point already stored
-- (same seq) is left as it was. Returns how many points were new.
-- Each point: {"seq", "segment", "lat", "lon", "acc", "t" (epoch ms), "mocked"}.
create function public.upload_gps_points(p_run_id text, p_points jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform public.gps_run_start(p_run_id, now());
  if p_points is null or jsonb_typeof(p_points) <> 'array'
     or jsonb_array_length(p_points) = 0 or jsonb_array_length(p_points) > 500 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;

  insert into public.gps_run_points (
    user_id, run_id, seq, segment, latitude, longitude, accuracy_m, recorded_at, mocked
  )
  select v_user, p_run_id, p.seq, p.segment, p.lat, p.lon, p.acc,
         to_timestamp(p.t / 1000.0), coalesce(p.mocked, false)
  from jsonb_to_recordset(p_points) as p(
    seq integer, segment integer, lat double precision, lon double precision,
    acc double precision, t bigint, mocked boolean
  )
  on conflict (user_id, run_id, seq) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
exception
  -- Missing or out-of-range fields: the upload is malformed, not a server fault.
  when not_null_violation or check_violation or invalid_text_representation
       or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'invalid_route' using errcode = '22023';
end;
$$;

revoke all on function public.upload_gps_points(text, jsonb) from public, anon;
grant execute on function public.upload_gps_points(text, jsonb) to authenticated;

-- 4. Claim -----------------------------------------------------------------------------------------
drop function public.claim_gps_reward(text, double precision, timestamptz);

create function public.claim_gps_reward(p_run_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_now        timestamptz := now();
  v_started    timestamptz;
  v_ref        text;
  v_point      record;
  -- The last counted point (null before the first one).
  v_last_seg   integer;
  v_last_lat   double precision;
  v_last_lon   double precision;
  v_last_at    timestamptz;
  v_seconds    double precision;
  v_metres     double precision;
  v_distance   double precision := 0;
  v_moving_s   double precision := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_started := public.gps_run_start(p_run_id, v_now);

  v_ref := v_user::text || ':' || p_run_id;
  perform public.lock_reward_credits(v_user);

  if exists (select 1 from public.reward_credits where source = 'gps' and source_ref = v_ref) then
    return 'already_earned';
  end if;

  -- Re-measure the route exactly as the app does (see run-tracker.ts `addLocations`).
  for v_point in
    select segment, latitude, longitude, accuracy_m, recorded_at, mocked
    from public.gps_run_points
    where user_id = v_user and run_id = p_run_id
    order by seq
  loop
    if v_point.mocked then
      raise exception 'mocked_location' using errcode = '22023';
    end if;
    if v_point.recorded_at < v_started - interval '1 second'
       or v_point.recorded_at > v_now + interval '2 minutes' then
      raise exception 'invalid_route' using errcode = '22023';
    end if;
    if v_point.accuracy_m is null or v_point.accuracy_m > 25 then continue; end if;

    -- First point, or first point after a pause: starts a fresh segment.
    if v_last_seg is null or v_point.segment <> v_last_seg then
      v_last_seg := v_point.segment;
      v_last_lat := v_point.latitude;
      v_last_lon := v_point.longitude;
      v_last_at  := v_point.recorded_at;
      continue;
    end if;

    v_seconds := extract(epoch from (v_point.recorded_at - v_last_at));
    if v_seconds <= 0 then continue; end if;
    v_metres := public.gps_distance_m(v_last_lat, v_last_lon, v_point.latitude, v_point.longitude);
    -- Jitter: keep the last point so small real movements still add up.
    if v_metres < 3 then continue; end if;
    -- GPS jump, not running.
    if v_metres / v_seconds > 10 then continue; end if;

    v_distance := v_distance + v_metres;
    v_moving_s := v_moving_s + v_seconds;
    v_last_lat := v_point.latitude;
    v_last_lon := v_point.longitude;
    v_last_at  := v_point.recorded_at;
  end loop;

  -- Half a metre of slack for floating-point differences between the phone and the server.
  if v_distance < 4999.5 or v_distance > 100000 then
    raise exception 'not_qualifying' using errcode = '22023';
  end if;
  -- Nobody averages faster than 6 m/s (about 2:47 per km) over 5 km+.
  if v_distance / greatest(v_moving_s, 1) > 6 then
    raise exception 'implausible_route' using errcode = '22023';
  end if;
  -- Not enough real time has passed since the run started (the app waits, then retries).
  if extract(epoch from (v_now - v_started)) < v_distance / 6.0 then
    raise exception 'implausible_pace' using errcode = '22023';
  end if;

  -- Strava already rewarded this same run (e.g. this claim was queued while offline).
  if exists (
    select 1 from public.strava_activities a
    where a.user_id = v_user and a.reward_decision = 'earned'
      and a.start_date between v_started - interval '15 minutes' and v_started + interval '15 minutes'
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

revoke all on function public.claim_gps_reward(text) from public, anon;
grant execute on function public.claim_gps_reward(text) to authenticated;
