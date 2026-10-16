/**
 * Tiny on-device JSON storage in the app's document directory.
 * Failures are swallowed so a storage problem never breaks the app; callers get the fallback.
 */
import { File, Paths } from 'expo-file-system';

function fileFor(name: string) {
  return new File(Paths.document, `${name}.json`);
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    const file = fileFor(name);
    if (!file.exists) return fallback;
    return JSON.parse(file.textSync()) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, data: unknown) {
  try {
    const file = fileFor(name);
    if (!file.exists) file.create();
    file.write(JSON.stringify(data));
  } catch {
    // Keep running with in-memory data if the write fails.
  }
}

export function deleteJson(name: string) {
  try {
    const file = fileFor(name);
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}
