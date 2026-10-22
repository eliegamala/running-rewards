-- Participating cafés, moved from the app into the database.
--
-- * stores / store_locations: public listings, readable by anyone using the app (signed in or
--   not); only active stores are visible. Edited in the Supabase dashboard (no client writes).
-- * store-images: a public bucket for product cut-outs and up to two venue photos per store.
--   Uploads happen in the dashboard; the app only reads public URLs.
-- * Reward credits can only be spent at a store that exists and is active.
--
-- Unknown details stay null rather than guessed: reward (shown as "to be confirmed"),
-- description, Google Maps link and coordinates (the app looks up the address instead).

create table public.stores (
  id                 text primary key check (id ~ '^[a-z0-9-]{1,64}$'),
  name               text not null check (char_length(name) between 1 and 80),
  category           text not null check (category in ('coffee', 'matcha', 'breakfast', 'run-club')),
  reward             text check (reward is null or char_length(reward) between 1 and 80),
  description        text check (description is null or char_length(description) <= 300),
  product_image_path text,
  venue_image_paths  text[] not null default '{}' check (cardinality(venue_image_paths) <= 2),
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.store_locations (
  id              uuid primary key default gen_random_uuid(),
  store_id        text not null references public.stores (id) on delete cascade,
  name            text check (name is null or char_length(name) between 1 and 80),
  address         text not null check (char_length(address) between 1 and 200),
  google_maps_url text check (
    google_maps_url is null
    or google_maps_url ~ '^https://((www\.)?google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)/'
  ),
  latitude        double precision check (latitude between -90 and 90),
  longitude       double precision check (longitude between -180 and 180),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  constraint store_locations_coordinates_pair check ((latitude is null) = (longitude is null))
);

create index store_locations_store_id_idx on public.store_locations (store_id);

create function public.touch_stores_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stores_touch_updated_at
  before update on public.stores
  for each row execute function public.touch_stores_updated_at();

alter table public.stores enable row level security;
alter table public.store_locations enable row level security;
revoke all on table public.stores, public.store_locations from anon, authenticated;
grant select on table public.stores, public.store_locations to anon, authenticated;
grant select, insert, update, delete on table public.stores, public.store_locations to service_role;

create policy "stores: active are public" on public.stores
  for select to anon, authenticated using (is_active);
create policy "store_locations: of active stores are public" on public.store_locations
  for select to anon, authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.is_active));

-- Public images (marketing material supplied by the cafés). No client upload policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-images', 'store-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Credits may only reference real stores. NOT VALID: checked for new values, so credits that
-- mention the old built-in demo stores don't block this migration.
alter table public.reward_credits
  add constraint reward_credits_selected_store_fk
    foreign key (selected_store_id) references public.stores (id) on update cascade not valid,
  add constraint reward_credits_redeemed_store_fk
    foreign key (redeemed_store_id) references public.stores (id) on update cascade not valid;

-- Choosing a store: same rules as before, plus the store must exist and be active.
create or replace function public.select_reward_store(p_credit_id uuid, p_store_id text)
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
  if p_store_id is null or p_store_id !~ '^[a-z0-9-]{1,64}$'
     or not exists (select 1 from public.stores where id = p_store_id and is_active) then
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

-- Test cafés (addresses as supplied; rewards, links, photos and coordinates to follow).
insert into public.stores (id, name, category, sort_order) values
  ('hundred-percent-cafe', 'Hundred Percent Cafe', 'coffee', 1),
  ('black-duke', 'Black Duke', 'coffee', 2),
  ('truth-coffee-roasting', 'Truth Coffee Roasting', 'coffee', 3),
  ('the-blue-cafe', 'The Blue Cafe', 'coffee', 4);

insert into public.store_locations (store_id, address) values
  ('hundred-percent-cafe', '287 Lower Main Rd, Observatory, Cape Town, 7700'),
  ('black-duke', '202 Lower Main Rd, Observatory, Cape Town, 7925'),
  ('truth-coffee-roasting', '36 Buitenkant St, Cape Town City Centre, Cape Town, 8000'),
  ('the-blue-cafe', '13 Brownlow Rd, Tamboerskloof, Cape Town, 8001');
