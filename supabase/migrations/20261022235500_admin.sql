-- Admin: manage cafés from the app and see reward statistics.
--
-- Security is enforced here, not by hiding screens:
-- * public.admins lists admin accounts. Clients can't read or change it; admins are added
--   by the project owner in the database.
-- * Every admin action also needs a session that passed two-step login (aal2), so a stolen
--   password alone can't change anything.
-- * Admins can edit café listings, locations and images and read totals. They can't see
--   other users' emails, profiles, Strava data or individual rewards, and can't delete
--   stores (they hide them instead).
-- * Every change to stores and locations is written to admin_audit_log by a trigger.

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;
grant select, insert, delete on table public.admins to service_role;

-- Is the caller an admin (any session)? Used by the app to show the Admin entry.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- Admin AND this session passed two-step login. Required for every admin action.
create function public.is_admin_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

revoke all on function public.is_admin(), public.is_admin_verified() from public, anon;
grant execute on function public.is_admin(), public.is_admin_verified() to authenticated;

-- ---- Editing stores and locations -----------------------------------------------------------

grant insert (id, name, category, reward, description, product_image_path, venue_image_paths,
              opening_hours, sort_order, is_active)
  on table public.stores to authenticated;
grant update (name, category, reward, description, product_image_path, venue_image_paths,
              opening_hours, sort_order, is_active)
  on table public.stores to authenticated;
grant insert (store_id, name, address, google_maps_url, latitude, longitude, sort_order),
      update (name, address, google_maps_url, latitude, longitude, sort_order),
      delete
  on table public.store_locations to authenticated;

create policy "stores: admins see all" on public.stores
  for select to authenticated using (public.is_admin_verified());
create policy "stores: admins add" on public.stores
  for insert to authenticated with check (public.is_admin_verified());
create policy "stores: admins edit" on public.stores
  for update to authenticated
  using (public.is_admin_verified()) with check (public.is_admin_verified());

create policy "store_locations: admins see all" on public.store_locations
  for select to authenticated using (public.is_admin_verified());
create policy "store_locations: admins add" on public.store_locations
  for insert to authenticated with check (public.is_admin_verified());
create policy "store_locations: admins edit" on public.store_locations
  for update to authenticated
  using (public.is_admin_verified()) with check (public.is_admin_verified());
create policy "store_locations: admins remove" on public.store_locations
  for delete to authenticated using (public.is_admin_verified());

-- Store images (public bucket): only verified admins can upload, replace or remove.
create policy "store-images: admins upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-images' and public.is_admin_verified());
create policy "store-images: admins replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'store-images' and public.is_admin_verified())
  with check (bucket_id = 'store-images' and public.is_admin_verified());
create policy "store-images: admins remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-images' and public.is_admin_verified());
create policy "store-images: admins list" on storage.objects
  for select to authenticated
  using (bucket_id = 'store-images' and public.is_admin_verified());

-- ---- Change history ------------------------------------------------------------------------

create table public.admin_audit_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users (id) on delete set null, -- null = changed in the dashboard
  action     text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id  text not null,
  changes    jsonb not null,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;
grant select on table public.admin_audit_log to authenticated;
grant select on table public.admin_audit_log to service_role;
create policy "audit: admins read" on public.admin_audit_log
  for select to authenticated using (public.is_admin_verified());

create function public.log_store_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_changes jsonb;
begin
  if tg_op = 'UPDATE' then
    -- Only the fields that changed: { field: [before, after] }.
    select coalesce(jsonb_object_agg(key, jsonb_build_array(v_old -> key, value)), '{}'::jsonb)
    into v_changes
    from jsonb_each(v_new)
    where key not in ('updated_at') and v_old -> key is distinct from value;
    if v_changes = '{}'::jsonb then return new; end if;
  else
    v_changes := coalesce(v_new, v_old);
  end if;

  insert into public.admin_audit_log (admin_id, action, table_name, record_id, changes)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_changes
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.log_store_change() from public, anon, authenticated;

create trigger stores_audit
  after insert or update or delete on public.stores
  for each row execute function public.log_store_change();
create trigger store_locations_audit
  after insert or update or delete on public.store_locations
  for each row execute function public.log_store_change();

-- ---- Statistics ----------------------------------------------------------------------------

-- Totals only (no individual runners). Times are in South African time.
create function public.admin_reward_stats(p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := now();
  v_result jsonb;
begin
  if not public.is_admin_verified() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  with credits as (
    select * from public.reward_credits
    where p_since is null or unlocked_at >= p_since
  ),
  redeemed as (
    select * from credits where redeemed_at is not null
  )
  select jsonb_build_object(
    'generatedAt', v_now,
    'runners', (select count(*) from auth.users),
    'activeRunners', (select count(distinct user_id) from credits),
    'stravaConnected', (select count(*) from public.strava_connections where status = 'connected'),
    'unlocked', (select count(*) from credits),
    'redeemed', (select count(*) from redeemed),
    'expiredUnused', (select count(*) from credits where redeemed_at is null and expires_at <= v_now),
    'activeNow', (select count(*) from credits where redeemed_at is null and expires_at > v_now),
    'bySource', jsonb_build_object(
      'gps', (select count(*) from credits where source = 'gps'),
      'strava', (select count(*) from credits where source = 'strava')
    ),
    'stores', coalesce((
      select jsonb_agg(row_to_json(s) order by s.redeemed desc, s.chosen desc, s.name)
      from (
        select st.id, st.name, st.is_active as "isActive",
               count(c.id) filter (where c.selected_store_id = st.id) as chosen,
               count(c.id) filter (where c.redeemed_store_id = st.id) as redeemed,
               max(c.redeemed_at) filter (where c.redeemed_store_id = st.id) as "lastRedeemedAt"
        from public.stores st
        left join credits c on c.selected_store_id = st.id
        group by st.id, st.name, st.is_active
      ) s
    ), '[]'::jsonb),
    'byWeekday', (
      select jsonb_agg(coalesce(n, 0) order by d)
      from generate_series(0, 6) d
      left join (
        select extract(dow from redeemed_at at time zone 'Africa/Johannesburg')::int as dow, count(*) as n
        from redeemed group by 1
      ) w on w.dow = d
    ),
    'byHour', (
      select jsonb_agg(coalesce(n, 0) order by h)
      from generate_series(0, 23) h
      left join (
        select extract(hour from redeemed_at at time zone 'Africa/Johannesburg')::int as hour, count(*) as n
        from redeemed group by 1
      ) x on x.hour = h
    ),
    'minutesToRedeem', (
      select round(avg(extract(epoch from (redeemed_at - unlocked_at)) / 60.0))::int from redeemed
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_reward_stats(timestamptz) from public, anon;
grant execute on function public.admin_reward_stats(timestamptz) to authenticated;
