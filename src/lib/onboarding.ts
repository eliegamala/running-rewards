/**
 * Tracks the "Connect Strava" onboarding step per account, on this device.
 *
 * The step is shown after sign-in while the server reports Strava as not connected, until
 * the runner connects or skips it. It can be reopened later from Profile → Strava.
 */
import { readJson, writeJson } from '@/lib/local-json';
import type { StravaStatus } from '@/lib/strava';

const STORAGE_NAME = 'onboarding';

export type OnboardingRecord = Record<string, { stravaStepSkipped: boolean }>;

let records = readJson<OnboardingRecord>(STORAGE_NAME, {});
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOnboardingRecords() {
  return records;
}

/** Only redirect once the server has confirmed Strava isn't connected. */
export function needsStravaStep(
  current: OnboardingRecord,
  userId: string | null,
  stravaStatus: StravaStatus,
) {
  if (userId === null) return false;
  return stravaStatus === 'not_connected' && !current[userId]?.stravaStepSkipped;
}

/** Marks the onboarding step as done (connected or skipped) so it isn't forced again. */
export function finishStravaStep(userId: string) {
  records = { ...records, [userId]: { stravaStepSkipped: true } };
  writeJson(STORAGE_NAME, records);
  listeners.forEach((listener) => listener());
}
