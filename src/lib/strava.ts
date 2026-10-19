/**
 * Strava connection for the signed-in runner, via the `strava` Edge Function.
 *
 * The app never sees Strava tokens or the client secret. "Connected" is only ever set from
 * the server's status response — never from the browser redirect alone. Activities are read
 * from the server-verified `strava_activities` table (read-only, own rows only via RLS).
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type StravaStatus =
  | 'unavailable' // Supabase not configured (or dev preview)
  | 'unknown' // not checked yet
  | 'not_connected'
  | 'connected'
  | 'revoked' // access was withdrawn; reconnect needed
  | 'error'; // status couldn't be checked

export type StravaActivity = {
  activity_id: number;
  name: string | null;
  sport_type: string | null;
  distance_m: number;
  start_date: string | null;
  is_manual: boolean;
  qualifies: boolean;
};

export type StravaState = {
  status: StravaStatus;
  athleteId: number | null;
  scope: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  activities: StravaActivity[] | null; // null = not loaded
};

const INITIAL: StravaState = {
  status: supabase ? 'unknown' : 'unavailable',
  athleteId: null,
  scope: null,
  connectedAt: null,
  lastSyncedAt: null,
  activities: null,
};

let state: StravaState = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<StravaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStravaState() {
  return state;
}

/** Whether "Only You" activities are visible (needs activity:read_all). */
export function canSeePrivateActivities(scope: string | null) {
  return !!scope && scope.split(/[\s,]+/).includes('activity:read_all');
}

// ---- Server calls ------------------------------------------------------------------------

type CallResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; retryAfter?: number };

async function callStrava(body: Record<string, unknown>): Promise<CallResult> {
  if (!supabase) return { ok: false, error: 'unavailable' };
  try {
    const { data, error } = await supabase.functions.invoke('strava', { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const payload = await (error.context as Response).json().catch(() => null);
        return {
          ok: false,
          error: typeof payload?.error === 'string' ? payload.error : 'server_error',
          retryAfter: typeof payload?.retryAfter === 'number' ? payload.retryAfter : undefined,
        };
      }
      return { ok: false, error: 'network' };
    }
    return { ok: true, data: (data ?? {}) as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export function messageFor(error: string, retryAfter?: number) {
  switch (error) {
    case 'denied':
      return 'You cancelled on Strava, so nothing was connected.';
    case 'missing_scope':
      return 'Strava needs permission to view your activities. Try again and keep "View data about your activities" ticked.';
    case 'athlete_in_use':
      return 'This Strava account is already connected to a different account in this app.';
    case 'invalid_return_url':
      return "The server didn't accept this app's return link. If you're using Expo Go, STRAVA_ALLOW_EXPO_GO_RETURN must be enabled on the server.";
    case 'not_configured':
      return "Strava isn't configured on the server yet.";
    case 'unauthorized':
      return 'Your session has expired. Please log out and log in again.';
    case 'revoked':
      return 'Strava access was withdrawn. Connect Strava again to continue.';
    case 'not_connected':
      return 'Strava is not connected.';
    case 'rate_limited':
      return `Strava is busy right now. Please try again${retryAfter ? ` in about ${Math.ceil(retryAfter / 60)} min` : ' later'}.`;
    case 'cooldown':
      return `Already up to date. You can sync again in ${Math.max(1, Math.ceil((retryAfter ?? 300) / 60))} min.`;
    case 'network':
      return "Couldn't reach the server. Check your connection and try again.";
    case 'strava_unavailable':
      return "Strava didn't respond. Please try again shortly.";
    case 'unavailable':
      return 'Strava needs a signed-in account.';
    default:
      return 'Something went wrong with Strava. Please try again.';
  }
}

// Status comes from our own database (never Strava), but avoid repeat calls anyway.
const STATUS_CACHE_MS = 60 * 1000;
let lastStatusCheck = 0;

/** Re-reads the connection status. Cached briefly unless `force` (after any change). */
export async function refreshStravaStatus({ force = false }: { force?: boolean } = {}) {
  if (!supabase || getAuthState().status !== 'signedIn') return;
  if (!force && state.status !== 'unknown' && state.status !== 'error' && Date.now() - lastStatusCheck < STATUS_CACHE_MS) {
    return;
  }
  lastStatusCheck = Date.now();
  const result = await callStrava({ action: 'status' });
  if (!result.ok) {
    update({ status: 'error' });
    return;
  }
  const d = result.data;
  const status = d.status === 'connected' || d.status === 'revoked' ? d.status : 'not_connected';
  update({
    status,
    athleteId: typeof d.athleteId === 'number' ? d.athleteId : null,
    scope: typeof d.scope === 'string' ? d.scope : null,
    connectedAt: typeof d.connectedAt === 'string' ? d.connectedAt : null,
    lastSyncedAt: typeof d.lastSyncedAt === 'string' ? d.lastSyncedAt : null,
  });
}

export type ActionResult = { ok: true } | { ok: false; message: string; cancelled?: boolean };

/**
 * Opens Strava's authorization page in the secure in-app browser. Success is decided by the
 * server's status afterwards, not by the redirect parameters.
 */
export async function connectStrava(): Promise<ActionResult> {
  const returnUrl = Linking.createURL('strava-callback');
  const started = await callStrava({ action: 'connect', returnUrl });
  if (!started.ok) return { ok: false, message: messageFor(started.error) };

  const authorizeUrl = started.data.authorizeUrl;
  if (typeof authorizeUrl !== 'string') return { ok: false, message: messageFor('server_error') };

  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnUrl);
  await refreshStravaStatus({ force: true });
  if (state.status === 'connected') return { ok: true };

  if (result.type !== 'success') {
    return { ok: false, cancelled: true, message: 'Strava connection was cancelled.' };
  }
  const reason = Linking.parse(result.url).queryParams?.reason;
  return { ok: false, message: messageFor(typeof reason === 'string' ? reason : 'failed') };
}

/** Reads the server-verified activities (RLS: own rows only). */
export async function loadStravaActivities() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('strava_activities')
    .select('activity_id, name, sport_type, distance_m, start_date, is_manual, qualifies')
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
    .limit(20);
  if (!error) update({ activities: (data ?? []) as StravaActivity[] });
  return error ? { ok: false as const } : { ok: true as const };
}

/** Manual sync fallback (webhooks keep things up to date once registered). */
export async function syncStrava(): Promise<ActionResult> {
  const result = await callStrava({ action: 'sync' });
  if (!result.ok) {
    if (result.error === 'revoked' || result.error === 'not_connected') {
      await refreshStravaStatus({ force: true });
    }
    return { ok: false, message: messageFor(result.error, result.retryAfter) };
  }
  await Promise.all([refreshStravaStatus({ force: true }), loadStravaActivities()]);
  return { ok: true };
}

export async function disconnectStrava(): Promise<ActionResult> {
  const result = await callStrava({ action: 'disconnect' });
  if (!result.ok) return { ok: false, message: messageFor(result.error) };
  update({ activities: null });
  await refreshStravaStatus({ force: true });
  return { ok: true };
}

// Reset and re-check whenever the signed-in account changes.
let lastUserId: string | null = null;
subscribeToAuth(() => {
  const { userId } = getAuthState();
  if (userId === lastUserId) return;
  lastUserId = userId;
  state = INITIAL;
  listeners.forEach((listener) => listener());
  lastStatusCheck = 0;
  if (userId) void refreshStravaStatus({ force: true });
});

// A session restored before this module loaded doesn't trigger the listener above.
if (getAuthState().userId) {
  lastUserId = getAuthState().userId;
  void refreshStravaStatus({ force: true });
}
