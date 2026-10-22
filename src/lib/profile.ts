/**
 * Runner profile — display name and profile photo — saved to the account: the `profiles`
 * table and the private `avatars` Storage bucket (own folder only, via RLS).
 *
 * A per-runner copy of the name and photo path is cached on the phone so Profile shows
 * instantly; the server is the source of truth. Photos are shown through short-lived
 * signed URLs, and resized to a small JPEG before upload.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import { deleteJson, readJson, writeJson } from '@/lib/local-json';
import { supabase } from '@/lib/supabase';

const CACHE_NAME = 'profile-cache';
/** Before profiles were saved to the account, the name lived only on the phone. */
const LEGACY_NAME = 'profile';
const AVATAR_BUCKET = 'avatars';
const AVATAR_SIZE = 512;
const SIGNED_URL_SECONDS = 60 * 60;
export const DISPLAY_NAME_MAX = 30;

export type Profile = {
  displayName: string;
  /** Storage path, e.g. "<user id>/avatar-1792684709560.jpg"; also the image cache key. */
  avatarPath: string | null;
  /** Signed URL (or the just-picked local file) for showing the photo. */
  avatarUrl: string | null;
  /** True while a new photo is being processed or uploaded. */
  avatarBusy: boolean;
};

type Cache = { userId: string; displayName: string; avatarPath: string | null };
export type ProfileResult = { ok: true } | { ok: false; message: string };

const EMPTY: Profile = { displayName: '', avatarPath: null, avatarUrl: null, avatarBusy: false };

let profile: Profile = EMPTY;
const listeners = new Set<() => void>();

function update(patch: Partial<Profile>) {
  profile = { ...profile, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProfile() {
  return profile;
}

function signedInUserId() {
  const auth = getAuthState();
  return auth.status === 'signedIn' ? auth.userId : null;
}

function saveCache(userId: string) {
  writeJson(CACHE_NAME, {
    userId,
    displayName: profile.displayName,
    avatarPath: profile.avatarPath,
  } satisfies Cache);
}

const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

async function signedUrlFor(path: string) {
  if (!supabase) return null;
  const { data } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}

async function saveProfileRow(userId: string, row: { display_name?: string; avatar_path?: string | null }) {
  if (!supabase) return false;
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, ...row });
  return !error;
}

async function loadFromServer(userId: string) {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_path')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || signedInUserId() !== userId) return;

  if (!data) {
    // First time on this account: carry over a name typed before profiles were saved.
    const legacy = readJson<{ displayName?: string } | null>(LEGACY_NAME, null);
    const displayName = (legacy?.displayName ?? '').trim().slice(0, DISPLAY_NAME_MAX);
    if (displayName && (await saveProfileRow(userId, { display_name: displayName }))) {
      deleteJson(LEGACY_NAME);
      update({ displayName });
      saveCache(userId);
    }
    return;
  }

  const avatarPath = (data.avatar_path as string | null) ?? null;
  const avatarUrl = avatarPath
    ? avatarPath === profile.avatarPath && profile.avatarUrl
      ? profile.avatarUrl
      : await signedUrlFor(avatarPath)
    : null;
  if (signedInUserId() !== userId) return;
  update({ displayName: (data.display_name as string) ?? '', avatarPath, avatarUrl });
  saveCache(userId);
}

function loadForUser(userId: string | null) {
  const cache = readJson<Cache | null>(CACHE_NAME, null);
  if (userId && cache?.userId === userId) {
    update({ ...EMPTY, displayName: cache.displayName, avatarPath: cache.avatarPath });
  } else {
    update(EMPTY);
  }
  if (userId) void loadFromServer(userId);
}

/** Saves the name to the account. On failure the previous name is kept. */
export async function setDisplayName(name: string): Promise<ProfileResult> {
  const displayName = name.trim().slice(0, DISPLAY_NAME_MAX);
  if (displayName === profile.displayName) return { ok: true };
  const userId = signedInUserId();
  if (!userId) {
    // Preview mode (no account): keep it for this session only.
    update({ displayName });
    return { ok: true };
  }
  const previous = profile.displayName;
  update({ displayName });
  if (!(await saveProfileRow(userId, { display_name: displayName }))) {
    if (signedInUserId() === userId) update({ displayName: previous });
    return { ok: false, message: `Your name wasn't saved. ${NETWORK_MESSAGE}` };
  }
  saveCache(userId);
  return { ok: true };
}

export function canHaveProfilePhoto() {
  return !!supabase && signedInUserId() !== null;
}

async function removeStoredPhoto(path: string | null) {
  if (supabase && path) await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}

/** Resizes a picked photo to a small square JPEG, uploads it, then points the profile at it. */
export async function setProfilePhoto(uri: string): Promise<ProfileResult> {
  const userId = signedInUserId();
  if (!supabase || !userId) return { ok: false, message: 'Profile photos need a signed-in account.' };
  if (profile.avatarBusy) return { ok: false, message: 'Still saving your last photo.' };
  update({ avatarBusy: true });
  try {
    const rendered = await ImageManipulator.manipulate(uri)
      .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
      .renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    const bytes = await new File(saved.uri).arrayBuffer();

    const path = `${userId}/avatar-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg' });
    if (uploadError) return { ok: false, message: `Your photo wasn't saved. ${NETWORK_MESSAGE}` };

    if (!(await saveProfileRow(userId, { avatar_path: path }))) {
      await removeStoredPhoto(path);
      return { ok: false, message: `Your photo wasn't saved. ${NETWORK_MESSAGE}` };
    }
    const previousPath = profile.avatarPath;
    if (signedInUserId() === userId) {
      update({ avatarPath: path, avatarUrl: saved.uri });
      saveCache(userId);
    }
    if (previousPath && previousPath !== path) await removeStoredPhoto(previousPath);
    return { ok: true };
  } catch {
    return { ok: false, message: "That photo couldn't be used. Try a different one." };
  } finally {
    update({ avatarBusy: false });
  }
}

export async function removeProfilePhoto(): Promise<ProfileResult> {
  const userId = signedInUserId();
  const path = profile.avatarPath;
  if (!userId || !path) return { ok: true };
  if (!(await saveProfileRow(userId, { avatar_path: null }))) {
    return { ok: false, message: `Your photo wasn't removed. ${NETWORK_MESSAGE}` };
  }
  update({ avatarPath: null, avatarUrl: null });
  saveCache(userId);
  await removeStoredPhoto(path);
  return { ok: true };
}

/** After an account is deleted: forget its profile on this phone. */
export function forgetProfileOnDevice() {
  deleteJson(CACHE_NAME);
  deleteJson(LEGACY_NAME);
  update(EMPTY);
}

let lastUserId: string | null = signedInUserId();
loadForUser(lastUserId);

subscribeToAuth(() => {
  const userId = signedInUserId();
  if (userId === lastUserId) return;
  lastUserId = userId;
  loadForUser(userId);
});
