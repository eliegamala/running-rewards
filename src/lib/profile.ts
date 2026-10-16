/** Runner profile details, stored on this device only. No account needed. */
import { deleteJson, readJson, writeJson } from '@/lib/local-json';

const STORAGE_NAME = 'profile';

export type Profile = {
  displayName: string;
};

let profile: Profile = readJson<Profile>(STORAGE_NAME, { displayName: '' });
const listeners = new Set<() => void>();

function update(next: Profile) {
  profile = next;
  writeJson(STORAGE_NAME, profile);
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

export function setDisplayName(name: string) {
  const displayName = name.trim().slice(0, 30);
  if (displayName !== profile.displayName) update({ ...profile, displayName });
}

export function clearProfile() {
  deleteJson(STORAGE_NAME);
  profile = { displayName: '' };
  listeners.forEach((listener) => listener());
}
