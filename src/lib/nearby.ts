/**
 * Distance from the runner to each café, worked out on the phone. The runner's position is
 * never sent anywhere.
 *
 * A café's exact coordinates are used when the database has them; otherwise its address is
 * looked up once with the phone's geocoder and remembered. Location is only read when
 * permission has already been given (or the runner taps "Show nearest first").
 */
import * as Location from 'expo-location';
import { AppState } from 'react-native';

import { readJson, writeJson } from '@/lib/local-json';
import {
  ADDRESS_COMING_SOON,
  getStores,
  type Store,
  subscribe as subscribeToStores,
} from '@/lib/stores';

type Point = { latitude: number; longitude: number };

export type NearbyState = {
  permission: 'undetermined' | 'granted' | 'denied';
  position: Point | null;
  /** Looked-up coordinates by address. */
  places: Record<string, Point>;
};

const GEOCODE_CACHE = 'store-geocode';
const POSITION_MAX_AGE_MS = 10 * 60 * 1000;
const GEOCODE_GAP_MS = 400;

let state: NearbyState = {
  permission: 'undetermined',
  position: null,
  places: readJson<Record<string, Point>>(GEOCODE_CACHE, {}),
};
const listeners = new Set<() => void>();

function update(patch: Partial<NearbyState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNearbyState() {
  return state;
}

// ---- Maths and formatting -------------------------------------------------------------------

const EARTH_RADIUS_M = 6371000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Straight-line (great-circle) distance in metres. */
export function distanceBetween(a: Point, b: Point) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "350 m", "1.2 km", "14 km". */
export function formatDistance(metres: number) {
  if (metres < 950) return `${Math.max(50, Math.round(metres / 50) * 50)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Distance to the store's nearest location, or null when it can't be known yet. */
export function distanceToStore(store: Store, nearby: NearbyState = state) {
  if (!nearby.position) return null;
  let best: number | null = null;
  for (const location of store.locations) {
    const point =
      location.latitude !== null && location.longitude !== null
        ? { latitude: location.latitude, longitude: location.longitude }
        : nearby.places[location.address];
    if (!point) continue;
    const metres = distanceBetween(nearby.position, point);
    if (best === null || metres < best) best = metres;
  }
  return best;
}

/** Nearest first; stores without a known distance keep their order, after the rest. */
export function sortByDistance(stores: Store[], nearby: NearbyState = state) {
  return stores
    .map((store, index) => ({ store, index, metres: distanceToStore(store, nearby) }))
    .sort((a, b) => {
      if (a.metres === null && b.metres === null) return a.index - b.index;
      if (a.metres === null) return 1;
      if (b.metres === null) return -1;
      return a.metres - b.metres;
    })
    .map((entry) => entry.store);
}

// ---- Position and address lookup ------------------------------------------------------------

let refreshing: Promise<void> | null = null;

async function readPosition() {
  const recent = await Location.getLastKnownPositionAsync({ maxAge: POSITION_MAX_AGE_MS });
  const fix =
    recent ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
}

/** Looks up addresses without exact coordinates, one at a time, remembering each answer. */
async function lookUpAddresses() {
  const pending = new Set<string>();
  for (const store of getStores()) {
    for (const location of store.locations) {
      if (location.latitude !== null) continue;
      if (location.address === ADDRESS_COMING_SOON || state.places[location.address]) continue;
      pending.add(location.address);
    }
  }
  for (const address of pending) {
    try {
      const [match] = await Location.geocodeAsync(address);
      if (match) {
        const places = {
          ...state.places,
          [address]: { latitude: match.latitude, longitude: match.longitude },
        };
        writeJson(GEOCODE_CACHE, places);
        update({ places });
      }
    } catch {
      // Not found or rate-limited: tried again next time.
    }
    await new Promise((resolve) => setTimeout(resolve, GEOCODE_GAP_MS));
  }
}

/**
 * Updates the runner's position and café coordinates. Asks for location permission only
 * when `ask` is true (from a button the runner tapped).
 */
export function refreshNearby({ ask = false }: { ask?: boolean } = {}): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && ask && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        update({ permission: permission.canAskAgain ? 'undetermined' : 'denied' });
        return;
      }
      update({ permission: 'granted' });
      update({ position: await readPosition() });
      await lookUpAddresses();
    } catch {
      // Location services off or unavailable: distances simply don't show.
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

void refreshNearby();
// New cafés in the list may need their address looked up.
subscribeToStores(() => {
  if (state.permission === 'granted') void refreshNearby();
});
AppState.addEventListener('change', (next) => {
  if (next === 'active') void refreshNearby();
});
