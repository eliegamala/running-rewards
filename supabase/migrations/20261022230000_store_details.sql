-- Café page details: up to three venue photos, opening hours (or when a run club meets),
-- and the first run club.

alter table public.stores drop constraint stores_venue_image_paths_check;
alter table public.stores
  add constraint stores_venue_image_paths_check check (cardinality(venue_image_paths) <= 3);

alter table public.stores
  add column opening_hours text check (opening_hours is null or char_length(opening_hours) <= 120);

-- Details (reward, meeting point, times) to follow; nothing guessed.
insert into public.stores (id, name, category, sort_order)
values ('plus-ultra-run-club', '+Ultra Run Club', 'run-club', 5);
