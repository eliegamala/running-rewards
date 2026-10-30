/**
 * The runner's reward credit, as issued by the server (Supabase `reward_credits`).
 *
 * The server is the only source of truth and enforces every rule: one credit per qualifying
 * run, one active credit at a time, expiry exactly one hour after unlocking, store selection
 * separate from redemption, and a single redemption at the selected store.
 *
 * This module only mirrors it:
 *   - reads the runner's credits (RLS: own rows only) and derives each status;
 *   - asks the server to select a store / redeem;
 *   - claims a reward for in-app GPS runs that pass 5 km: it uploads the run's GPS points and
 *     the server measures the distance itself.
 * A small display cache shows the last known state on an offline launch; it can't grant
 * anything, because every action goes through the server.
 */
import { AppState } from 'react-native';

import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import { deleteJson, readJson, writeJson } from '@/lib/local-json';
import {
  getRoute,
  getSnapshot as getRunSnapshot,
  type RoutePoint,
  subscribe as subscribeToRun,
} from '@/lib/run-tracker';
import { supabase } from '@/lib/supabase';

export const REWARD_DISTANCE_KM = 5;
export const REWARD_DURATION_MS = 60 * 60 * 1000;

export type RewardStatus = 'locked' | 'unlocked' | 'redeemed' | 'expired';

export type RewardCredit = {
  /** Server credit id; null when there is no credit. */
  id: string | null;
  source: 'strava' | 'gps' | null;
  status: RewardStatus;
  unlockedAt: number | null;
  expiresAt: number | null;
  /** Store chosen for the live pass. Set once; the credit is only used on redeem. */
  selectedStoreId: string | null;
  redeemedAt: number | null;
  redeemedStoreId: string | null;
};

type CreditRow = {
  id: string;
  source: 'strava' | 'gps';
  unlocked_at: string;
  expires_at: string;
  selected_store_id: string | null;
  redeemed_at: string | null;
  redeemed_store_id: string | null;
};

export type RewardTotals = { earned: number; redeemed: number };

const CREDIT_COLUMNS =
  'id, source, unlocked_at, expires_at, selected_store_id, redeemed_at, redeemed_store_id';
const HISTORY_LIMIT = 25;
const CACHE_NAME = 'reward-credits-cache';
const CLAIMS_NAME = 'gps-reward-claims';

const LOCKED: RewardCredit = {
  id: null,
  source: null,
  status: 'locked',
  unlockedAt: null,
  expiresAt: null,
  selectedStoreId: null,
  redeemedAt: null,
  redeemedStoreId: null,
};

function toCredit(row: CreditRow, now: number): RewardCredit {
  const expiresAt = Date.parse(row.expires_at);
  const redeemedAt = row.redeemed_at ? Date.parse(row.redeemed_at) : null;
  return {
    id: row.id,
    source: row.source,
    status: redeemedAt !== null ? 'redeemed' : expiresAt <= now ? 'expired' : 'unlocked',
    unlockedAt: Date.parse(row.unlocked_at),
    expiresAt,
    selectedStoreId: row.selected_store_id,
    redeemedAt,
    redeemedStoreId: row.redeemed_store_id,
  };
}

// ---- Store ------------------------------------------------------------------------------

let rows: CreditRow[] = [];
let credit: RewardCredit = LOCKED;
let history: RewardCredit[] = [];
let totals: RewardTotals = { earned: 0, redeemed: 0 };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function applyRows(next: CreditRow[], nextTotals?: RewardTotals) {
  rows = next;
  const now = Date.now();
  history = rows.map((row) => toCredit(row, now));
  credit = history[0] ?? LOCKED; // newest credit
  if (nextTotals) totals = nextTotals;
  emit();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The newest credit (active, or the last one used/expired), or a locked placeholder. */
export function getRewardCredit() {
  return credit;
}

/** Newest first, up to the last 25 credits. */
export function getRewardCredits() {
  return history;
}

/** All-time counts from the server. */
export function getRewardTotals() {
  return totals;
}

/** Re-derives statuses when the hour runs out (the server enforces expiry independently). */
export function expireRewardIfDue() {
  if (credit.status === 'unlocked' && credit.expiresAt !== null && credit.expiresAt <= Date.now()) {
    applyRows(rows);
  }
}

// ---- Server reads -----------------------------------------------------------------------

type Cache = { userId: string; rows: CreditRow[]; totals: RewardTotals };

function signedInUserId() {
  const auth = getAuthState();
  return auth.status === 'signedIn' ? auth.userId : null;
}

let refreshing: Promise<void> | null = null;

/** Fetches the runner's credits and totals from the server. */
export function refreshRewards(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const userId = signedInUserId();
    if (!supabase || !userId) return;
    const [list, earned, redeemed] = await Promise.all([
      supabase
        .from('reward_credits')
        .select(CREDIT_COLUMNS)
        .order('unlocked_at', { ascending: false })
        .limit(HISTORY_LIMIT),
      supabase.from('reward_credits').select('id', { count: 'exact', head: true }),
      supabase
        .from('reward_credits')
        .select('id', { count: 'exact', head: true })
        .not('redeemed_at', 'is', null),
    ]);
    // Ignore failures (e.g. offline): keep showing the last known state.
    if (list.error || earned.error || redeemed.error || signedInUserId() !== userId) return;
    const nextRows = (list.data ?? []) as CreditRow[];
    const nextTotals = { earned: earned.count ?? nextRows.length, redeemed: redeemed.count ?? 0 };
    applyRows(nextRows, nextTotals);
    writeJson(CACHE_NAME, { userId, rows: nextRows, totals: nextTotals } satisfies Cache);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// ---- Server actions ---------------------------------------------------------------------

export type RewardActionResult = { ok: true } | { ok: false; reason: string };

const SERVER_REASONS = [
  'expired',
  'already_redeemed',
  'store_already_selected',
  'wrong_store',
  'not_found',
  'invalid_store',
  'not_authenticated',
];

function reasonFrom(error: { message?: string } | null) {
  const message = error?.message ?? '';
  return SERVER_REASONS.find((reason) => message.includes(reason)) ?? 'network';
}

/** Ties the current credit to one store so the live pass can open. Doesn't redeem. */
export async function selectStore(storeId: string): Promise<RewardActionResult> {
  if (!supabase || !credit.id) return { ok: false, reason: 'not_found' };
  const { error } = await supabase.rpc('select_reward_store', {
    p_credit_id: credit.id,
    p_store_id: storeId,
  });
  await refreshRewards();
  return error ? { ok: false, reason: reasonFrom(error) } : { ok: true };
}

/** Spends the current credit at the selected store. The server checks expiry and store. */
export async function redeemReward(storeId: string): Promise<RewardActionResult> {
  if (!supabase || !credit.id) return { ok: false, reason: 'not_found' };
  const { error } = await supabase.rpc('redeem_reward', {
    p_credit_id: credit.id,
    p_store_id: storeId,
  });
  await refreshRewards();
  return error ? { ok: false, reason: reasonFrom(error) } : { ok: true };
}

// ---- GPS runs: claim a reward from the server --------------------------------------------

type PendingClaim = {
  userId: string;
  runId: string;
  startedAt: number;
  distanceMeters: number;
  /** The run's GPS points up to passing 5 km; the server measures the distance from these. */
  route: RoutePoint[];
  /** How many of `route` the server has already stored. */
  uploaded: number;
};

/** The server rejects claims faster than 6 m/s on average; wait until a claim is plausible. */
const MAX_SPEED_MPS = 6;
const CLAIM_MARGIN_MS = 15 * 1000;
const RETRY_MS = 30 * 1000;
/** The server takes at most this many points per upload. */
const UPLOAD_CHUNK = 500;
/** Claims the server will never accept again are dropped. */
const PERMANENT_REASONS = [
  'not_qualifying',
  'not_recent',
  'invalid_run',
  'invalid_route',
  'implausible_route',
  'mocked_location',
];

// Claims saved by an older version carry no route and can never be accepted.
let claims = readJson<PendingClaim[]>(CLAIMS_NAME, []).filter((c) => Array.isArray(c.route));
const claimedRunIds = new Set(claims.map((c) => c.runId));
let processingClaims = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function saveClaims(next: PendingClaim[]) {
  claims = next;
  writeJson(CLAIMS_NAME, claims);
}

function scheduleClaims(delayMs: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processClaims();
  }, Math.max(delayMs, 1000));
}

/** Sends the points the server doesn't have yet. Resumes where a failed attempt stopped. */
async function uploadRoute(claim: PendingClaim) {
  if (!supabase) return { message: 'network' };
  let uploaded = claim.uploaded;
  while (uploaded < claim.route.length) {
    const chunk = claim.route.slice(uploaded, uploaded + UPLOAD_CHUNK);
    const { error } = await supabase.rpc('upload_gps_points', {
      p_run_id: claim.runId,
      p_points: chunk.map((p) => ({
        seq: p.seq,
        segment: p.segment,
        lat: p.latitude,
        lon: p.longitude,
        acc: p.accuracy,
        t: p.timestamp,
        mocked: p.mocked,
      })),
    });
    if (error) return error;
    uploaded += chunk.length;
    saveClaims(claims.map((c) => (c.runId === claim.runId ? { ...c, uploaded } : c)));
  }
  return null;
}

async function processClaims() {
  const userId = signedInUserId();
  if (!supabase || !userId || processingClaims) return;
  processingClaims = true;
  let nextDelay: number | null = null;
  try {
    for (const claim of claims.filter((c) => c.userId === userId)) {
      const plausibleAt =
        claim.startedAt + (claim.distanceMeters / MAX_SPEED_MPS) * 1000 + CLAIM_MARGIN_MS;
      if (Date.now() < plausibleAt) {
        nextDelay = Math.min(nextDelay ?? Infinity, plausibleAt - Date.now());
        continue;
      }
      let data: unknown = null;
      let error = await uploadRoute(claim);
      if (!error) {
        ({ data, error } = await supabase.rpc('claim_gps_reward', { p_run_id: claim.runId }));
      }
      const message = error?.message ?? '';
      const permanent = PERMANENT_REASONS.some((reason) => message.includes(reason));
      if (!error || permanent) {
        // 'earned', 'already_earned', 'active_reward' or a definite rejection: done.
        saveClaims(claims.filter((c) => c.runId !== claim.runId));
        if (!error && data === 'earned') await refreshRewards();
      } else {
        nextDelay = Math.min(nextDelay ?? Infinity, RETRY_MS); // offline etc.: try again
      }
    }
  } finally {
    processingClaims = false;
  }
  if (nextDelay !== null) scheduleClaims(nextDelay);
}

// The moment an in-app run passes 5 km, queue one claim for it (persisted, retried).
subscribeToRun(() => {
  const run = getRunSnapshot();
  const userId = signedInUserId();
  if (!userId || !run.isActive || run.startTime === null) return;
  // A mock-location app was used: the server would refuse, so don't send anything.
  if (run.mockedLocation) return;
  if (run.distanceMeters < REWARD_DISTANCE_KM * 1000) return;
  const runId = String(run.startTime);
  if (claimedRunIds.has(runId)) return;
  claimedRunIds.add(runId);
  saveClaims([
    ...claims,
    {
      userId,
      runId,
      startedAt: run.startTime,
      distanceMeters: run.distanceMeters,
      route: [...getRoute()],
      uploaded: 0,
    },
  ]);
  void processClaims();
});

// ---- Lifecycle -----------------------------------------------------------------------------

// Rewards used to be kept only on the phone; that data is no longer used.
deleteJson('reward-credit');
deleteJson('reward-history');

function loadForUser(userId: string | null) {
  const cache = readJson<Cache | null>(CACHE_NAME, null);
  if (userId && cache?.userId === userId) applyRows(cache.rows, cache.totals);
  else {
    totals = { earned: 0, redeemed: 0 };
    applyRows([]);
  }
  if (userId) {
    void refreshRewards();
    void processClaims();
  }
}

/** After an account is deleted: drop its cached rewards and unsent GPS claims from this phone. */
export function forgetUserOnDevice(userId: string) {
  if (readJson<Cache | null>(CACHE_NAME, null)?.userId === userId) deleteJson(CACHE_NAME);
  saveClaims(claims.filter((c) => c.userId !== userId));
}

let lastUserId: string | null = signedInUserId();
loadForUser(lastUserId);

subscribeToAuth(() => {
  const userId = signedInUserId();
  if (userId === lastUserId) return;
  lastUserId = userId;
  loadForUser(userId);
});

AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  void refreshRewards();
  void processClaims();
});
