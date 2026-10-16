-- Strava integration: connections (encrypted tokens), OAuth state, and verified activities.
--
-- Security model
--   * strava_connections / strava_oauth_states are server-only: RLS on, no policies, and all
--     privileges revoked from anon/authenticated. Only Edge Functions (secret key) touch them.
--   * Tokens are encrypted (AES-GCM) by the Edge Functions before they reach the database.
--   * strava_activities is readable by its owner only; clients can never insert/update/delete.
--     Rows are written exclusively through record_strava_activities(), which is executable
--     by service_role only.
--   * The Strava activity id is the primary key, i.e. the idempotency key: repeated syncs,
--     webhook retries and edits update the same row instead of creating new ones.

-- 1. Connections ---------------------------------------------------------------------------
create table public.strava_connections (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  athlete_id        bigint not null unique,           -- one Strava athlete per app account
  scope             text not null,
  access_token_enc  text,                              -- null once revoked
  refresh_token_enc text,
  token_expires_at  timestamptz,
  status            text not null default 'connected'
                    check (status in ('connected', 'revoked')),
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_synced_at    timestamptz
);

alter table public.strava_connections enable row level security;
revoke all on table public.strava_connections from anon, authenticated;

-- 2. OAuth state (CSRF / account-linking protection) ----------------------------------------
-- Only a SHA-256 hash of the state is stored; each row is single-use and short-lived.
create table public.strava_oauth_states (
  state_hash  text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  return_url  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index strava_oauth_states_user_id_idx on public.strava_oauth_states (user_id);

alter table public.strava_oauth_states enable row level security;
revoke all on table public.strava_oauth_states from anon, authenticated;

-- 3. Verified activities ------------------------------------------------------------------
create table public.strava_activities (
  activity_id    bigint primary key,                   -- Strava activity id (idempotency key)
  user_id        uuid not null references auth.users (id) on delete cascade,
  athlete_id     bigint not null,
  name           text,
  sport_type     text,
  distance_m     double precision not null,
  moving_time_s  integer,
  start_date     timestamptz,
  is_manual      boolean not null default false,
  qualifies      boolean not null default false,       -- computed server-side
  deleted_at     timestamptz,                          -- soft delete keeps the id reserved
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index strava_activities_user_start_idx
  on public.strava_activities (user_id, start_date desc);

alter table public.strava_activities enable row level security;
revoke all on table public.strava_activities from anon, authenticated;
grant select on table public.strava_activities to authenticated;

create policy "Runners can read their own Strava activities"
  on public.strava_activities
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 4. Idempotent, ownership-preserving writes ----------------------------------------------
-- Inserts new activities and updates existing ones. An existing activity is only updated
-- when it belongs to the same athlete, and its user_id is never reassigned.
create function public.record_strava_activities(
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
      activity_id   bigint,
      name          text,
      sport_type    text,
      distance_m    double precision,
      moving_time_s integer,
      start_date    timestamptz,
      is_manual     boolean,
      qualifies     boolean
    )
  ),
  written as (
    insert into public.strava_activities as existing (
      activity_id, user_id, athlete_id, name, sport_type, distance_m,
      moving_time_s, start_date, is_manual, qualifies
    )
    select distinct on (activity_id)
      activity_id, p_user_id, p_athlete_id, name, sport_type, distance_m,
      moving_time_s, start_date, coalesce(is_manual, false), coalesce(qualifies, false)
    from incoming
    order by activity_id
    on conflict (activity_id) do update
      set name          = excluded.name,
          sport_type    = excluded.sport_type,
          distance_m    = excluded.distance_m,
          moving_time_s = excluded.moving_time_s,
          start_date    = excluded.start_date,
          is_manual     = excluded.is_manual,
          qualifies     = excluded.qualifies,
          deleted_at    = null,
          updated_at    = now()
      where existing.athlete_id = excluded.athlete_id
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke all on function public.record_strava_activities(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.record_strava_activities(uuid, bigint, jsonb) to service_role;
