-- Café pages: featured products (name + photo), logos and menu photos. Run clubs removed.
--
-- * store_products: each café's best items (up to 6). The first one (lowest sort_order) is
--   the "signature" shown on Home. Public read for active cafés; verified admins edit.
-- * stores.logo_path: shown on Find your ritual and the café page.
-- * stores.menu_image_paths: up to three photos of the menu.
-- * stores.product_image_path is replaced by store_products (no café had one set).
-- * Run clubs are no longer a category; the one listing is removed.

create table public.store_products (
  id         uuid primary key default gen_random_uuid(),
  store_id   text not null references public.stores (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  image_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index store_products_store_id_idx on public.store_products (store_id, sort_order);

-- At most six featured products per café.
create function public.limit_store_products()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.store_products where store_id = new.store_id) >= 6 then
    raise exception 'too_many_products' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger store_products_limit
  before insert on public.store_products
  for each row execute function public.limit_store_products();

alter table public.store_products enable row level security;
revoke all on table public.store_products from anon, authenticated;
grant select on table public.store_products to anon, authenticated;
grant insert (store_id, name, image_path, sort_order),
      update (name, image_path, sort_order),
      delete
  on table public.store_products to authenticated;
grant select, insert, update, delete on table public.store_products to service_role;

create policy "store_products: of active stores are public" on public.store_products
  for select to anon, authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.is_active));
create policy "store_products: admins see all" on public.store_products
  for select to authenticated using (public.is_admin_verified());
create policy "store_products: admins add" on public.store_products
  for insert to authenticated with check (public.is_admin_verified());
create policy "store_products: admins edit" on public.store_products
  for update to authenticated
  using (public.is_admin_verified()) with check (public.is_admin_verified());
create policy "store_products: admins remove" on public.store_products
  for delete to authenticated using (public.is_admin_verified());

create trigger store_products_audit
  after insert or update or delete on public.store_products
  for each row execute function public.log_store_change();

-- Logo and menu photos.
alter table public.stores
  add column logo_path text,
  add column menu_image_paths text[] not null default '{}'
    check (cardinality(menu_image_paths) <= 3);

grant insert (logo_path, menu_image_paths), update (logo_path, menu_image_paths)
  on table public.stores to authenticated;

-- Replaced by store_products.
alter table public.stores drop column product_image_path;

-- Run clubs are no longer part of the app.
delete from public.stores where category = 'run-club';
alter table public.stores drop constraint stores_category_check;
alter table public.stores
  add constraint stores_category_check check (category in ('coffee', 'matcha', 'breakfast'));
