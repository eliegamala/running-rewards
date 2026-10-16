/**
 * A record of past reward credits for the Profile screen, stored on this device.
 *
 * This only listens to the existing reward credit and writes down what happened to it
 * (unlocked, then redeemed or expired). It never changes the credit or its rules.
 * One entry per credit, keyed by the credit's `unlockedAt`.
 */
import { deleteJson, readJson, writeJson } from '@/lib/local-json';
import { getRewardCredit, subscribe as subscribeToReward } from '@/lib/reward-credit';
import { getStore } from '@/lib/stores';

const STORAGE_NAME = 'reward-history';

export type RewardHistoryEntry = {
  /** The credit's `unlockedAt`, which identifies each credit. */
  id: string;
  unlockedAt: number;
  status: 'unlocked' | 'redeemed' | 'expired';
  /** When it was redeemed or expired. */
  endedAt: number | null;
  /** Snapshot of the store and offer at the time, so later data changes don't rewrite history. */
  storeName: string | null;
  reward: string | null;
};

let entries = readJson<RewardHistoryEntry[]>(STORAGE_NAME, []);
const listeners = new Set<() => void>();

// The reward credit is restored before this module loads, so any still-"unlocked" entry
// that isn't the current credit belongs to a credit that no longer exists (e.g. one lost
// before rewards were saved). It can't be used, so record it as expired, once.
{
  const currentId = String(getRewardCredit().unlockedAt);
  if (entries.some((entry) => entry.status === 'unlocked' && entry.id !== currentId)) {
    const now = Date.now();
    entries = entries.map((entry) =>
      entry.status === 'unlocked' && entry.id !== currentId
        ? { ...entry, status: 'expired', endedAt: now }
        : entry,
    );
    writeJson(STORAGE_NAME, entries);
  }
}

function save(next: RewardHistoryEntry[]) {
  entries = next;
  writeJson(STORAGE_NAME, entries);
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRewardHistory() {
  return entries;
}

export function clearRewardHistory() {
  deleteJson(STORAGE_NAME);
  save([]);
}

// Entries are keyed by the credit's `unlockedAt`, so re-syncing never adds duplicates.
function syncWithCredit() {
  const credit = getRewardCredit();
  if (credit.unlockedAt === null) return;

  const id = String(credit.unlockedAt);
  const existing = entries.find((entry) => entry.id === id);

  if (!existing) {
    save([
      ...entries,
      {
        id,
        unlockedAt: credit.unlockedAt,
        status: 'unlocked',
        endedAt: null,
        storeName: null,
        reward: null,
      },
    ]);
    return;
  }

  if (existing.status !== 'unlocked') return;
  if (credit.status !== 'redeemed' && credit.status !== 'expired') return;

  const store = getStore(credit.redeemedStoreId ?? credit.selectedStoreId ?? '');
  const ended: RewardHistoryEntry = {
    ...existing,
    status: credit.status,
    endedAt: credit.status === 'redeemed' ? credit.redeemedAt : credit.expiresAt,
    storeName: store?.name ?? null,
    reward: store?.reward ?? null,
  };
  save(entries.map((entry) => (entry.id === id ? ended : entry)));
}

// Catch up with the restored credit (e.g. it expired while the app was closed), then follow it.
syncWithCredit();
subscribeToReward(syncWithCredit);
