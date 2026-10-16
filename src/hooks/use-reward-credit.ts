import { useEffect, useState, useSyncExternalStore } from 'react';

import { getSnapshot as getRunSnapshot, subscribe as subscribeToRun } from '@/lib/run-tracker';
import {
  expireRewardIfDue,
  getRewardCredit,
  REWARD_DISTANCE_KM,
  REWARD_DURATION_MS,
  subscribe,
} from '@/lib/reward-credit';

export function formatCountdown(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** Local time as HH:MM, e.g. when a reward was used. */
export function formatClockTime(timestamp: number) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** "5" before a run starts, then one decimal place ("2.4") while running. */
export function formatKm(km: number) {
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}

/**
 * Live reward-credit state for the UI. The countdown is derived from `expiresAt`
 * on every tick rather than decremented, so it stays correct after the app sleeps.
 */
export function useRewardCredit() {
  const credit = useSyncExternalStore(subscribe, getRewardCredit);
  const run = useSyncExternalStore(subscribeToRun, getRunSnapshot);

  const [now, setNow] = useState(0);
  useEffect(() => {
    if (credit.status !== 'unlocked') return;
    const tick = () => {
      setNow(Date.now());
      expireRewardIfDue();
    };
    const id = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [credit.status]);

  const remainingMs =
    credit.expiresAt === null
      ? 0
      : Math.min(Math.max(credit.expiresAt - now, 0), REWARD_DURATION_MS);

  // Treat a credit whose hour is up as expired even before the store catches up.
  const status =
    credit.status === 'unlocked' && now > 0 && remainingMs === 0 ? 'expired' : credit.status;

  // Only the current run counts towards unlocking.
  const runKm = run.isActive ? run.distanceMeters / 1000 : 0;
  const kmToUnlock = Math.max(REWARD_DISTANCE_KM - runKm, 0);

  return { credit, status, remainingMs, kmToUnlock };
}
