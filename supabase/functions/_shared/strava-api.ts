/**
 * Minimal Strava API client (OAuth + activities). `fetch` is injectable for tests.
 * Never logs or returns tokens in error messages.
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_REVOKE_URL = 'https://www.strava.com/oauth/revoke';
const STRAVA_API = 'https://www.strava.com/api/v3';

export type StravaErrorKind =
  | 'unauthorized' // token invalid/revoked, or bad code
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'server'
  | 'network';

export class StravaApiError extends Error {
  constructor(
    readonly kind: StravaErrorKind,
    readonly status: number,
  ) {
    super(`Strava API error: ${kind} (${status})`);
  }
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds since epoch
  scope?: string;
  athlete?: { id: number };
};

export type StravaCredentials = { clientId: string; clientSecret: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function kindForStatus(status: number): StravaErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

async function request(fetchFn: FetchLike, url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch {
    throw new StravaApiError('network', 0);
  }
  if (!response.ok) {
    // Consume the body so connections are released, but never surface it (may echo inputs).
    await response.text().catch(() => undefined);
    // Strava returns 400 for invalid/expired codes and refresh tokens.
    const kind =
      response.status === 400 && url === STRAVA_TOKEN_URL ? 'unauthorized' : kindForStatus(response.status);
    throw new StravaApiError(kind, response.status);
  }
  return response;
}

function isTokenResponse(value: unknown): value is TokenResponse {
  const v = value as TokenResponse;
  return (
    !!v &&
    typeof v.access_token === 'string' &&
    typeof v.refresh_token === 'string' &&
    typeof v.expires_at === 'number'
  );
}

export function createStravaApi(credentials: StravaCredentials, fetchFn: FetchLike = fetch) {
  async function tokenRequest(params: Record<string, string>) {
    const response = await request(fetchFn, STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        ...params,
      }).toString(),
    });
    const body = await response.json();
    if (!isTokenResponse(body)) throw new StravaApiError('server', response.status);
    return body;
  }

  return {
    /** Server-side authorization code exchange. The code is single-use. */
    exchangeCode(code: string) {
      return tokenRequest({ code, grant_type: 'authorization_code' });
    },

    /** The returned refresh token may differ; the old one stops working immediately. */
    refresh(refreshToken: string) {
      return tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    },

    /** Revokes the app's access for this athlete (all of its tokens). */
    async revoke(token: string) {
      const basic = btoa(`${credentials.clientId}:${credentials.clientSecret}`);
      await request(fetchFn, STRAVA_REVOKE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token }).toString(),
      });
    },

    async listActivities(accessToken: string, afterEpochSeconds: number, perPage = 50) {
      const url = `${STRAVA_API}/athlete/activities?after=${afterEpochSeconds}&per_page=${perPage}`;
      const response = await request(fetchFn, url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json();
      return Array.isArray(body) ? (body as unknown[]) : [];
    },

    async getActivity(accessToken: string, activityId: number) {
      const response = await request(fetchFn, `${STRAVA_API}/activities/${activityId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return (await response.json()) as unknown;
    },
  };
}

export type StravaApi = ReturnType<typeof createStravaApi>;
