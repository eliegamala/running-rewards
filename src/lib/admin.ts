/**
 * Admin tools: two-step login, reward statistics, and editing cafés.
 *
 * Nothing here is trusted for security: the database only accepts admin changes from
 * accounts on its admin list whose session passed two-step login (aal2). This module just
 * calls those protected tables and functions and turns errors into plain messages.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { refreshStores, type StoreCategory } from '@/lib/stores';

const IMAGE_BUCKET = 'store-images';
export const MAX_VENUE_PHOTOS = 3;

// ---- Is this account an admin? ---------------------------------------------------------------

let isAdmin = false;
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getIsAdmin() {
  return isAdmin;
}

async function checkAdmin() {
  const signedIn = getAuthState().status === 'signedIn';
  let next = false;
  if (supabase && signedIn) {
    const { data } = await supabase.rpc('is_admin');
    next = data === true;
  }
  if (next !== isAdmin) {
    isAdmin = next;
    listeners.forEach((listener) => listener());
  }
}

let lastUserId: string | null = null;
subscribeToAuth(() => {
  const { userId } = getAuthState();
  if (userId === lastUserId) return;
  lastUserId = userId;
  void checkAdmin();
});
void checkAdmin();

// ---- Two-step login (authenticator app) -------------------------------------------------------

export type TwoStepStatus = 'verified' | 'needs_code' | 'needs_setup' | 'error';

export async function getTwoStepStatus(): Promise<TwoStepStatus> {
  if (!supabase) return 'error';
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return 'error';
  if (data.currentLevel === 'aal2') return 'verified';
  return data.nextLevel === 'aal2' ? 'needs_code' : 'needs_setup';
}

export type TwoStepSetup = { factorId: string; secret: string; uri: string };

/** Starts adding an authenticator app (clears any half-finished attempt first). */
export async function startTwoStepSetup(): Promise<TwoStepSetup | { error: string }> {
  if (!supabase) return { error: 'Not available.' };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'RUN admin',
  });
  if (error || !data) return { error: "Couldn't start two-step setup. Please try again." };
  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
}

/** The verified authenticator to check a code against, if any. */
export async function getVerifiedFactorId() {
  if (!supabase) return null;
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp?.[0]?.id ?? null;
}

export async function verifyTwoStepCode(factorId: string, code: string) {
  if (!supabase) return { ok: false as const, message: 'Not available.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) {
    return {
      ok: false as const,
      message: "That code didn't work. Check the time on your phone and use the newest code.",
    };
  }
  return { ok: true as const };
}

// ---- Statistics -----------------------------------------------------------------------------

export type StoreStat = {
  id: string;
  name: string;
  isActive: boolean;
  chosen: number;
  redeemed: number;
  lastRedeemedAt: string | null;
};

export type RewardStats = {
  generatedAt: string;
  runners: number;
  activeRunners: number;
  stravaConnected: number;
  unlocked: number;
  redeemed: number;
  expiredUnused: number;
  activeNow: number;
  bySource: { gps: number; strava: number };
  stores: StoreStat[];
  /** Redemptions per weekday, Sunday first (South African time). */
  byWeekday: number[];
  /** Redemptions per hour 0–23 (South African time). */
  byHour: number[];
  minutesToRedeem: number | null;
};

export type StatsPeriod = '7d' | '30d' | 'all';

export async function loadStats(period: StatsPeriod) {
  if (!supabase) return { ok: false as const, message: 'Not available.' };
  const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
  const { data, error } = await supabase.rpc('admin_reward_stats', { p_since: since });
  if (error || !data) return { ok: false as const, message: messageFor(error) };
  return { ok: true as const, stats: data as RewardStats };
}

// ---- Cafés ---------------------------------------------------------------------------------

export type AdminLocation = {
  id: string;
  name: string | null;
  address: string;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  sort_order: number;
};

export type AdminStore = {
  id: string;
  name: string;
  category: StoreCategory;
  reward: string | null;
  description: string | null;
  opening_hours: string | null;
  product_image_path: string | null;
  venue_image_paths: string[];
  sort_order: number;
  is_active: boolean;
  store_locations: AdminLocation[];
};

export type StoreFields = Pick<
  AdminStore,
  'name' | 'category' | 'reward' | 'description' | 'opening_hours' | 'sort_order' | 'is_active'
>;
export type LocationFields = Omit<AdminLocation, 'id' | 'sort_order'>;

export type AdminResult = { ok: true } | { ok: false; message: string };

function messageFor(error: { code?: string; message?: string } | null): string {
  const text = error?.message ?? '';
  if (error?.code === '42501' || /row-level security|not_admin|permission denied/i.test(text)) {
    return 'Not allowed. Open Admin again and confirm your two-step code.';
  }
  if (error?.code === '23505') return 'A café with that name already exists.';
  if (error?.code === '23514') return 'One of the values isn’t allowed. Check lengths, links and coordinates.';
  return "Couldn't reach the server. Check your connection and try again.";
}

const STORE_COLUMNS =
  'id, name, category, reward, description, opening_hours, product_image_path, venue_image_paths, sort_order, is_active, ' +
  'store_locations (id, name, address, google_maps_url, latitude, longitude, sort_order)';

/** All cafés, including hidden ones (visible to verified admins only). */
export async function loadAdminStores() {
  if (!supabase) return { ok: false as const, message: 'Not available.' };
  const { data, error } = await supabase
    .from('stores')
    .select(STORE_COLUMNS)
    .order('sort_order')
    .order('name');
  if (error) return { ok: false as const, message: messageFor(error) };
  const stores = (data as unknown as AdminStore[]).map((s) => ({
    ...s,
    venue_image_paths: s.venue_image_paths ?? [],
    store_locations: [...(s.store_locations ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
  return { ok: true as const, stores };
}

export function imageUrl(path: string) {
  return supabase?.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl ?? null;
}

/** "Truth Coffee Roasting" → "truth-coffee-roasting" (the café's permanent id). */
export function slugFor(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, 'plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const blankToNull = (value: string | null) => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

function cleanStore(fields: StoreFields) {
  return {
    name: fields.name.trim(),
    category: fields.category,
    reward: blankToNull(fields.reward),
    description: blankToNull(fields.description),
    opening_hours: blankToNull(fields.opening_hours),
    sort_order: Number.isFinite(fields.sort_order) ? Math.round(fields.sort_order) : 0,
    is_active: fields.is_active,
  };
}

export async function createStore(fields: StoreFields) {
  if (!supabase) return { ok: false as const, message: 'Not available.' };
  const id = slugFor(fields.name);
  if (!id) return { ok: false as const, message: 'Give the café a name first.' };
  const { error } = await supabase.from('stores').insert({ id, ...cleanStore(fields) });
  if (error) return { ok: false as const, message: messageFor(error) };
  void refreshStores({ force: true });
  return { ok: true as const, id };
}

export async function updateStore(id: string, fields: StoreFields): Promise<AdminResult> {
  if (!supabase) return { ok: false, message: 'Not available.' };
  const { data, error } = await supabase.from('stores').update(cleanStore(fields)).eq('id', id).select('id');
  if (error) return { ok: false, message: messageFor(error) };
  if (!data?.length) return { ok: false, message: messageFor({ code: '42501' }) };
  void refreshStores({ force: true });
  return { ok: true };
}

/** Same format the database accepts. */
export function isGoogleMapsUrl(url: string) {
  return /^https:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(url);
}

export function checkLocation(fields: LocationFields): string | null {
  if (!fields.address.trim()) return 'Add the street address.';
  if (fields.google_maps_url && !isGoogleMapsUrl(fields.google_maps_url.trim())) {
    return 'The Maps link must be a Google Maps link (Share → Copy link in Google Maps).';
  }
  const hasLat = fields.latitude !== null;
  const hasLng = fields.longitude !== null;
  if (hasLat !== hasLng) return 'Add both latitude and longitude, or neither.';
  if (hasLat && (Math.abs(fields.latitude!) > 90 || Math.abs(fields.longitude!) > 180)) {
    return 'Those coordinates are out of range.';
  }
  return null;
}

function cleanLocation(fields: LocationFields) {
  return {
    name: blankToNull(fields.name),
    address: fields.address.trim(),
    google_maps_url: blankToNull(fields.google_maps_url),
    latitude: fields.latitude,
    longitude: fields.longitude,
  };
}

export async function saveLocation(storeId: string, locationId: string | null, fields: LocationFields): Promise<AdminResult> {
  if (!supabase) return { ok: false, message: 'Not available.' };
  const problem = checkLocation(fields);
  if (problem) return { ok: false, message: problem };
  const { error } = locationId
    ? await supabase.from('store_locations').update(cleanLocation(fields)).eq('id', locationId)
    : await supabase.from('store_locations').insert({ store_id: storeId, ...cleanLocation(fields) });
  if (error) return { ok: false, message: messageFor(error) };
  void refreshStores({ force: true });
  return { ok: true };
}

export async function deleteLocation(locationId: string): Promise<AdminResult> {
  if (!supabase) return { ok: false, message: 'Not available.' };
  const { error } = await supabase.from('store_locations').delete().eq('id', locationId);
  if (error) return { ok: false, message: messageFor(error) };
  void refreshStores({ force: true });
  return { ok: true };
}

// ---- Café images ---------------------------------------------------------------------------

/**
 * Resizes and uploads a picked image, then points the café at it and removes the file it
 * replaced. Product photos stay PNG (to keep transparent backgrounds); venue photos are JPEG.
 */
export async function setStoreImage(
  store: AdminStore,
  uri: string,
  kind: 'product' | 'venue',
): Promise<AdminResult> {
  if (!supabase) return { ok: false, message: 'Not available.' };
  if (kind === 'venue' && store.venue_image_paths.length >= MAX_VENUE_PHOTOS) {
    return { ok: false, message: `A café can have up to ${MAX_VENUE_PHOTOS} venue photos.` };
  }
  let path: string;
  try {
    const rendered = await ImageManipulator.manipulate(uri)
      .resize({ width: kind === 'product' ? 800 : 1600, height: null })
      .renderAsync();
    const saved = await rendered.saveAsync(
      kind === 'product'
        ? { format: SaveFormat.PNG }
        : { format: SaveFormat.JPEG, compress: 0.75 },
    );
    const bytes = await new File(saved.uri).arrayBuffer();
    path = `${store.id}/${kind}-${Date.now()}.${kind === 'product' ? 'png' : 'jpg'}`;
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: kind === 'product' ? 'image/png' : 'image/jpeg' });
    if (error) {
      return {
        ok: false,
        message: /exceed|too large|payload/i.test(error.message)
          ? 'That image is too large. Try a smaller one.'
          : messageFor(error),
      };
    }
  } catch {
    return { ok: false, message: "That image couldn't be used. Try a different one." };
  }

  const patch =
    kind === 'product'
      ? { product_image_path: path }
      : { venue_image_paths: [...store.venue_image_paths, path] };
  const { error } = await supabase.from('stores').update(patch).eq('id', store.id);
  if (error) {
    await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    return { ok: false, message: messageFor(error) };
  }
  if (kind === 'product' && store.product_image_path) {
    await supabase.storage.from(IMAGE_BUCKET).remove([store.product_image_path]);
  }
  void refreshStores({ force: true });
  return { ok: true };
}

export async function removeStoreImage(store: AdminStore, path: string): Promise<AdminResult> {
  if (!supabase) return { ok: false, message: 'Not available.' };
  const patch =
    path === store.product_image_path
      ? { product_image_path: null }
      : { venue_image_paths: store.venue_image_paths.filter((p) => p !== path) };
  const { error } = await supabase.from('stores').update(patch).eq('id', store.id);
  if (error) return { ok: false, message: messageFor(error) };
  await supabase.storage.from(IMAGE_BUCKET).remove([path]);
  void refreshStores({ force: true });
  return { ok: true };
}

// ---- Change history ------------------------------------------------------------------------

export type AuditEntry = {
  id: number;
  admin_id: string | null;
  action: 'insert' | 'update' | 'delete';
  table_name: string;
  record_id: string;
  changes: Record<string, unknown>;
  created_at: string;
};

export async function loadRecentChanges(limit = 15) {
  if (!supabase) return { ok: false as const, message: 'Not available.' };
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('id, admin_id, action, table_name, record_id, changes, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false as const, message: messageFor(error) };
  return { ok: true as const, entries: (data ?? []) as AuditEntry[] };
}
