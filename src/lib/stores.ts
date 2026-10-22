/**
 * Participating stores, loaded from the database (`stores` + `store_locations`, public and
 * read-only) and cached on the phone so the app opens instantly and works offline.
 *
 * Each store (the business/brand) is one choice a reward credit can be spent at; unlocking
 * is handled separately in `reward-credit.ts`. A store has one or more physical locations.
 * Unknown details are left empty, never guessed.
 */
import { AppState, type ImageSourcePropType } from 'react-native';

import { readJson, writeJson } from '@/lib/local-json';
import { supabase } from '@/lib/supabase';

export type StoreCategory = 'coffee' | 'matcha' | 'breakfast' | 'run-club';

export type StoreLocation = {
  /** Branch/area name shown to the runner, e.g. a neighbourhood. Null until known. */
  name: string | null;
  address: string;
  /** The café's own Google Maps link, when supplied. */
  googleMapsUrl: string | null;
  /** Exact coordinates, when supplied; otherwise the app looks up the address. */
  latitude: number | null;
  longitude: number | null;
};

export const ADDRESS_COMING_SOON = 'Address coming soon';
export const REWARD_TO_BE_CONFIRMED = 'Reward to be confirmed';

export type Store = {
  id: string;
  name: string;
  category: StoreCategory;
  /** What this store offers when a runner spends their reward credit here. */
  reward: string;
  rewardConfirmed: boolean;
  description: string | null;
  /** Product cut-out (transparent PNG). Stores without one use the cup illustration. */
  productImageUrl: string | null;
  /** Up to three venue photos for the café page. */
  venueImageUrls: string[];
  /** Free text from the café, e.g. "Mon–Fri 6:30–16:00" (or when a run club meets). */
  openingHours: string | null;
  /** Where the reward can be redeemed. Every store has at least one. */
  locations: StoreLocation[];
};

export const CATEGORIES: { id: StoreCategory; label: string; emoji: string }[] = [
  { id: 'coffee', label: 'Coffee', emoji: '☕' },
  { id: 'matcha', label: 'Matcha', emoji: '🍵' },
  { id: 'breakfast', label: 'Breakfast', emoji: '🥐' },
  { id: 'run-club', label: 'Run Clubs', emoji: '🏃' },
];

export function getCategory(id: StoreCategory) {
  return CATEGORIES.find((category) => category.id === id) ?? CATEGORIES[0];
}

/** "1 spot", "3 spots"; run clubs are counted as clubs. */
export function countLabel(category: StoreCategory, count: number) {
  const noun = category === 'run-club' ? 'club' : 'spot';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * TEST STAND-INS: the matcha photos supplied earlier (they carry Starbucks and Platō
 * branding). Shown only for stores without their own product photo, until cafés send theirs.
 */
const STAND_IN_PRODUCT_IMAGES: ImageSourcePropType[] = [
  require('@/assets/images/products/plato-matcha.png'),
  require('@/assets/images/products/matcha-latte.png'),
];

/** The store's own product photo, else a stand-in picked consistently per store. */
export function productImageFor(store: Store): ImageSourcePropType {
  if (store.productImageUrl) return { uri: store.productImageUrl };
  let hash = 0;
  for (const char of store.id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return STAND_IN_PRODUCT_IMAGES[Math.abs(hash) % STAND_IN_PRODUCT_IMAGES.length];
}

// ---- Fresh order ---------------------------------------------------------------------------

/** How long one carousel order lasts before it reshuffles. */
export const FRESH_ORDER_MS = 5 * 60 * 60 * 1000;

/** Small seeded random generator (mulberry32), so an order holds for the whole window. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The same stores in an order that changes every 5 hours (and differs per `salt`, so two
 * carousels don't match). Everyone sees the same order in the same window.
 */
export function freshOrder<T>(items: T[], salt: number, now = Date.now()): T[] {
  const window = Math.floor(now / FRESH_ORDER_MS);
  const random = seededRandom(window * 7919 + salt * 104729);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---- Store list ------------------------------------------------------------------------------

export type StoresState = {
  stores: Store[];
  /** `loading` only until the first answer (or cached copy); `error` = no list at all. */
  status: 'loading' | 'ready' | 'error';
};

const CACHE_NAME = 'stores-cache';
const IMAGE_BUCKET = 'store-images';
const REFRESH_EVERY_MS = 10 * 60 * 1000;

const cached = readJson<Store[] | null>(CACHE_NAME, null);
let state: StoresState = cached ? { stores: cached, status: 'ready' } : { stores: [], status: 'loading' };
const listeners = new Set<() => void>();
let lastLoadedAt = 0;
let loading: Promise<void> | null = null;

function update(next: StoresState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStoresState() {
  return state;
}

export function getStores() {
  return state.stores;
}

export function getStore(id: string) {
  return state.stores.find((store) => store.id === id);
}

/**
 * Stand-in for a store the phone hasn't loaded (or that left the list), so an existing
 * pass can still be shown and redeemed; the server checks the real store.
 */
export function unlistedStore(id: string): Store {
  return {
    id,
    name: 'Your chosen spot',
    category: 'coffee',
    reward: REWARD_TO_BE_CONFIRMED,
    rewardConfirmed: false,
    description: null,
    productImageUrl: null,
    venueImageUrls: [],
    openingHours: null,
    locations: [],
  };
}

/** The location to show for a store. */
export function getPrimaryLocation(store: Store): StoreLocation {
  return store.locations[0] ?? {
    name: null,
    address: ADDRESS_COMING_SOON,
    googleMapsUrl: null,
    latitude: null,
    longitude: null,
  };
}

/**
 * The café's own Maps link, else a Google Maps search for its address (Google's documented
 * Maps URLs format). Null when there is no address yet.
 */
export function mapsUrlFor(location: StoreLocation) {
  if (location.googleMapsUrl) return location.googleMapsUrl;
  if (location.address === ADDRESS_COMING_SOON) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
}

type StoreRow = {
  id: string;
  name: string;
  category: string;
  reward: string | null;
  description: string | null;
  product_image_path: string | null;
  venue_image_paths: string[] | null;
  opening_hours: string | null;
  sort_order: number;
  store_locations:
    | {
        name: string | null;
        address: string;
        google_maps_url: string | null;
        latitude: number | null;
        longitude: number | null;
        sort_order: number;
      }[]
    | null;
};

const CATEGORY_IDS = CATEGORIES.map((category) => category.id) as string[];

export function toStore(row: StoreRow, publicUrl: (path: string) => string): Store {
  return {
    id: row.id,
    name: row.name,
    category: (CATEGORY_IDS.includes(row.category) ? row.category : 'coffee') as StoreCategory,
    reward: row.reward ?? REWARD_TO_BE_CONFIRMED,
    rewardConfirmed: row.reward !== null,
    description: row.description,
    productImageUrl: row.product_image_path ? publicUrl(row.product_image_path) : null,
    venueImageUrls: (row.venue_image_paths ?? []).slice(0, 3).map(publicUrl),
    openingHours: row.opening_hours ?? null,
    locations: [...(row.store_locations ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({
        name: l.name,
        address: l.address,
        googleMapsUrl: l.google_maps_url,
        latitude: l.latitude,
        longitude: l.longitude,
      })),
  };
}

/** Loads the list from the server (at most every 10 minutes unless `force`). */
export function refreshStores({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (!supabase) {
    if (state.status === 'loading') update({ stores: [], status: 'error' });
    return Promise.resolve();
  }
  if (loading) return loading;
  if (!force && state.status === 'ready' && Date.now() - lastLoadedAt < REFRESH_EVERY_MS) {
    return Promise.resolve();
  }
  const client = supabase;
  loading = (async () => {
    try {
      const { data, error } = await client
        .from('stores')
        .select(
          'id, name, category, reward, description, product_image_path, venue_image_paths, opening_hours, sort_order, ' +
            'store_locations (name, address, google_maps_url, latitude, longitude, sort_order)',
        )
        .order('sort_order')
        .order('name');
      if (error || !data) {
        if (state.status === 'loading') update({ stores: [], status: 'error' });
        return;
      }
      const publicUrl = (path: string) =>
        client.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      const stores = (data as unknown as StoreRow[]).map((row) => toStore(row, publicUrl));
      lastLoadedAt = Date.now();
      writeJson(CACHE_NAME, stores);
      update({ stores, status: 'ready' });
    } catch {
      if (state.status === 'loading') update({ stores: [], status: 'error' });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

void refreshStores();
AppState.addEventListener('change', (next) => {
  if (next === 'active') void refreshStores();
});
