/**
 * Pure Strava integration rules shared by the Edge Functions.
 * No Deno- or Node-specific APIs: only WebCrypto and standard JS, so this can be unit-tested.
 */

/** Least privilege: activities visible to Everyone/Followers. "Only You" runs need activity:read_all. */
export const STRAVA_SCOPE = 'activity:read';
export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';

export const STATE_TTL_MS = 10 * 60 * 1000;
/** Refresh access tokens this long before they expire. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Per-user cooldown between manual syncs, to protect the app's Strava rate limit. */
export const SYNC_COOLDOWN_MS = 30 * 1000;
/** How far back a manual sync looks. */
export const SYNC_WINDOW_DAYS = 30;

export const REWARD_DISTANCE_M = 5000;
/** Strava sport types that count as a run for rewards. */
export const QUALIFYING_SPORT_TYPES = ['Run', 'TrailRun'] as const;

// ---- OAuth state -----------------------------------------------------------------------

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 bits of randomness, URL-safe. */
export function generateState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A well-formed state is exactly what generateState() produces. */
export function isWellFormedState(state: unknown): state is string {
  return typeof state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(state);
}

export type StoredState = { user_id: string; return_url: string; expires_at: string };

/** Checks a consumed state row. The row must already have been deleted (single use). */
export function checkConsumedState(row: StoredState | null, now: number) {
  if (!row) return { ok: false as const, reason: 'invalid_state' };
  if (Date.parse(row.expires_at) <= now) return { ok: false as const, reason: 'expired_state' };
  return { ok: true as const, userId: row.user_id, returnUrl: row.return_url };
}

// ---- Return URL (where the callback sends the browser back to the app) -----------------

export const APP_SCHEME = 'runningrewardsapp';
export const RETURN_PATH = 'strava-callback';

/**
 * Only the app's own deep link may be used, never an arbitrary website (no open redirect).
 * Expo Go uses exp://<host>/--/strava-callback, which is allowed only when explicitly enabled.
 */
export function isAllowedReturnUrl(value: unknown, allowExpoGo: boolean): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.search || url.hash || url.username || url.password) return false;
  if (url.protocol === `${APP_SCHEME}:`) {
    // runningrewardsapp://strava-callback (host form) or runningrewardsapp:///strava-callback
    const target = (url.host + url.pathname).replace(/^\/+/, '');
    return target === RETURN_PATH;
  }
  if (url.protocol === 'exp:' && allowExpoGo) {
    return url.pathname === `/--/${RETURN_PATH}`;
  }
  return false;
}

export function withQuery(url: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

export function buildAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}) {
  return withQuery(STRAVA_AUTHORIZE_URL, {
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: options.scope ?? STRAVA_SCOPE,
    state: options.state,
  });
}

/** Users can untick scopes on Strava's page, so check what was actually granted. */
export function hasActivityReadScope(granted: unknown) {
  if (typeof granted !== 'string') return false;
  const scopes = granted.split(/[\s,]+/);
  return scopes.includes('activity:read') || scopes.includes('activity:read_all');
}

// ---- Activities ------------------------------------------------------------------------

export type ActivityRecord = {
  activity_id: number;
  name: string | null;
  sport_type: string | null;
  distance_m: number;
  moving_time_s: number | null;
  start_date: string | null;
  is_manual: boolean;
  qualifies: boolean;
};

/** Reward rule: a completed, recorded (not manual) Run/TrailRun of at least 5 km. */
export function isQualifyingActivity(activity: {
  sport_type: string | null;
  distance_m: number;
  is_manual: boolean;
}) {
  return (
    !activity.is_manual &&
    activity.distance_m >= REWARD_DISTANCE_M &&
    (QUALIFYING_SPORT_TYPES as readonly string[]).includes(activity.sport_type ?? '')
  );
}

/** Maps a Strava activity (summary or detail) to the minimal fields we store. */
export function normalizeActivity(raw: unknown): ActivityRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const id = typeof a.id === 'number' ? a.id : Number(a.id);
  const distance = typeof a.distance === 'number' ? a.distance : NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(distance) || distance < 0) {
    return null;
  }
  // `type` is deprecated in favour of `sport_type`; fall back for older payloads.
  const sportType =
    typeof a.sport_type === 'string' ? a.sport_type : typeof a.type === 'string' ? a.type : null;
  const record = {
    activity_id: id,
    name: typeof a.name === 'string' ? a.name.slice(0, 200) : null,
    sport_type: sportType,
    distance_m: distance,
    moving_time_s: typeof a.moving_time === 'number' ? Math.round(a.moving_time) : null,
    start_date: typeof a.start_date === 'string' ? a.start_date : null,
    is_manual: a.manual === true,
  };
  return { ...record, qualifies: isQualifyingActivity(record) };
}

// ---- Tokens & rate limits --------------------------------------------------------------

export function needsRefresh(expiresAt: string | null, now: number) {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) - now <= REFRESH_MARGIN_MS;
}

/** Strava's short-term limits reset at each 15-minute boundary (UTC). */
export function secondsUntilRateLimitReset(now: number) {
  const window = 15 * 60 * 1000;
  return Math.ceil((window - (now % window)) / 1000);
}

export function isInSyncCooldown(lastSyncedAt: string | null, now: number) {
  return lastSyncedAt !== null && now - Date.parse(lastSyncedAt) < SYNC_COOLDOWN_MS;
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
