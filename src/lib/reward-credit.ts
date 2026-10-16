/**
 * The runner's single reward credit.
 *
 * Running 5 km in one run unlocks ONE credit, which can be spent at any ONE participating
 * store within an hour of unlocking. Stores are just redemption choices for this credit;
 * there is no per-store unlock state.
 *
 * Lifecycle: locked → unlocked → (store selected, still `unlocked`) → redeemed, or expired
 * if the hour runs out first. Selecting a store doesn't use the credit; redeeming does.
 *
 * Only one credit exists at a time, and each run can earn at most one. Once a credit is
 * redeemed or expired, a different run reaching 5 km can unlock the next one.
 *
 * Saved on this device and restored synchronously at startup, before anything can read or
 * overwrite it, so an active reward survives the app being closed.
 */
import { readJson, writeJson } from '@/lib/local-json';
import { getSnapshot as getRunSnapshot, subscribe as subscribeToRun } from '@/lib/run-tracker';

export const REWARD_DISTANCE_KM = 5;
export const REWARD_DURATION_MS = 60 * 60 * 1000;

const STORAGE_NAME = 'reward-credit';
const STATUSES = ['locked', 'unlocked', 'redeemed', 'expired'] as const;

export type RewardStatus = (typeof STATUSES)[number];

export type RewardCredit = {
  status: RewardStatus;
  unlockedAt: number | null;
  expiresAt: number | null;
  /** Store chosen for the live pass. Set once; the credit is only used on redeem. */
  selectedStoreId: string | null;
  redeemedAt: number | null;
  redeemedStoreId: string | null;
  /** The run that earned this credit, so one run can never earn two. */
  earnedRunId: string | null;
};

const LOCKED: RewardCredit = {
  status: 'locked',
  unlockedAt: null,
  expiresAt: null,
  selectedStoreId: null,
  redeemedAt: null,
  redeemedStoreId: null,
  earnedRunId: null,
};

function restoreCredit(): RewardCredit {
  const saved = readJson<Partial<RewardCredit> | null>(STORAGE_NAME, null);
  if (!saved || !STATUSES.includes(saved.status as RewardStatus)) return LOCKED;
  const restored = { ...LOCKED, ...saved };
  // A non-locked credit without its timestamps can't be trusted; start fresh.
  if (
    restored.status !== 'locked' &&
    (restored.unlockedAt === null || restored.expiresAt === null)
  ) {
    return LOCKED;
  }
  return restored;
}

let credit: RewardCredit = restoreCredit();
const listeners = new Set<() => void>();

function update(next: RewardCredit) {
  credit = next;
  writeJson(STORAGE_NAME, credit);
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRewardCredit() {
  return credit;
}

function unlockReward(runId: string) {
  expireRewardIfDue();
  // One active credit at a time, and one credit per run.
  if (credit.status === 'unlocked' || credit.earnedRunId === runId) return;
  const unlockedAt = Date.now();
  update({
    ...LOCKED,
    status: 'unlocked',
    unlockedAt,
    expiresAt: unlockedAt + REWARD_DURATION_MS,
    earnedRunId: runId,
  });
}

/** Moves an unlocked credit to `expired` once its hour is up. */
export function expireRewardIfDue() {
  if (credit.status === 'unlocked' && credit.expiresAt !== null && Date.now() >= credit.expiresAt) {
    update({ ...credit, status: 'expired' });
  }
}

/**
 * Ties the credit to one store so the runner can open its live pass. The choice is final.
 * Returns false if the credit can't be used or a different store was already chosen.
 */
export function selectStore(storeId: string) {
  expireRewardIfDue();
  if (credit.status !== 'unlocked') return false;
  if (credit.selectedStoreId !== null) return credit.selectedStoreId === storeId;
  update({ ...credit, selectedStoreId: storeId });
  return true;
}

/**
 * Spends the credit at the selected store. Returns false if it can't be used
 * (expired, already used, or not the store the pass was opened for).
 */
export function redeemReward(storeId: string) {
  expireRewardIfDue();
  if (credit.status !== 'unlocked' || credit.selectedStoreId !== storeId) return false;
  update({ ...credit, status: 'redeemed', redeemedAt: Date.now(), redeemedStoreId: storeId });
  return true;
}

// A reward restored from storage may have run out while the app was closed.
expireRewardIfDue();

// The run tracker is the source of truth for distance. This also fires from the
// background location task, so the reward unlocks even while the screen is locked.
// Distance only grows while running, so pausing can never unlock a reward.
subscribeToRun(() => {
  const run = getRunSnapshot();
  if (run.isActive && run.startTime !== null && run.distanceMeters >= REWARD_DISTANCE_KM * 1000) {
    unlockReward(String(run.startTime));
  }
});
