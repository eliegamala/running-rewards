/**
 * Reward history for the Profile screen, read from the server's reward credits.
 * Nothing is stored or decided here; it's a view over `reward-credit.ts`.
 */
import {
  getRewardCredits,
  getRewardTotals,
  type RewardCredit,
  subscribe as subscribeToRewards,
} from '@/lib/reward-credit';
import { getStore } from '@/lib/stores';

export type RewardHistoryEntry = {
  /** Server credit id. */
  id: string;
  unlockedAt: number;
  status: 'unlocked' | 'redeemed' | 'expired';
  /** When it was redeemed or expired. */
  endedAt: number | null;
  storeName: string | null;
  reward: string | null;
};

function toEntry(credit: RewardCredit): RewardHistoryEntry | null {
  if (!credit.id || credit.unlockedAt === null || credit.status === 'locked') return null;
  const store = getStore(credit.redeemedStoreId ?? credit.selectedStoreId ?? '');
  return {
    id: credit.id,
    unlockedAt: credit.unlockedAt,
    status: credit.status,
    endedAt:
      credit.status === 'redeemed'
        ? credit.redeemedAt
        : credit.status === 'expired'
          ? credit.expiresAt
          : null,
    storeName: store?.name ?? null,
    reward: store?.reward ?? null,
  };
}

// Memoised so useSyncExternalStore sees a stable value until the credits change.
let source: RewardCredit[] | null = null;
let entries: RewardHistoryEntry[] = [];

export function getRewardHistory() {
  const credits = getRewardCredits();
  if (credits !== source) {
    source = credits;
    entries = credits.map(toEntry).filter((e): e is RewardHistoryEntry => e !== null);
  }
  return entries;
}

export { getRewardTotals };

export function subscribe(listener: () => void) {
  return subscribeToRewards(listener);
}
