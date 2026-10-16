/**
 * Returns a usable Strava access token for a user, refreshing when needed.
 *
 * Strava rotates refresh tokens: once a new one is issued the old one is invalid. If two
 * requests refresh at the same time, the loser's refresh fails even though the connection
 * is fine. So on a failed refresh we re-read the connection and use the winner's token
 * before concluding that access was revoked.
 */
import { StravaApiError, type StravaApi } from './strava-api.ts';
import { needsRefresh } from './strava-logic.ts';
import type { TokenCipher } from './token-crypto.ts';

export type ConnectionRow = {
  user_id: string;
  athlete_id: number;
  scope: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: 'connected' | 'revoked';
  last_synced_at: string | null;
};

export type TokenStore = {
  loadConnection(userId: string): Promise<ConnectionRow | null>;
  saveTokens(
    userId: string,
    tokens: { access_token_enc: string; refresh_token_enc: string; token_expires_at: string },
  ): Promise<void>;
  markRevoked(userId: string): Promise<void>;
};

export class StravaNotConnectedError extends Error {
  constructor(readonly reason: 'not_connected' | 'revoked') {
    super(reason);
  }
}

export async function getValidAccessToken(
  userId: string,
  deps: { store: TokenStore; api: Pick<StravaApi, 'refresh'>; cipher: TokenCipher; now: () => number },
): Promise<{ accessToken: string; connection: ConnectionRow }> {
  const connection = await deps.store.loadConnection(userId);
  if (!connection) throw new StravaNotConnectedError('not_connected');
  if (connection.status !== 'connected' || !connection.access_token_enc || !connection.refresh_token_enc) {
    throw new StravaNotConnectedError('revoked');
  }

  if (!needsRefresh(connection.token_expires_at, deps.now())) {
    return { accessToken: await deps.cipher.decrypt(connection.access_token_enc), connection };
  }

  try {
    const refreshed = await deps.api.refresh(await deps.cipher.decrypt(connection.refresh_token_enc));
    const tokens = {
      access_token_enc: await deps.cipher.encrypt(refreshed.access_token),
      refresh_token_enc: await deps.cipher.encrypt(refreshed.refresh_token),
      token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
    };
    await deps.store.saveTokens(userId, tokens);
    return { accessToken: refreshed.access_token, connection: { ...connection, ...tokens } };
  } catch (error) {
    if (!(error instanceof StravaApiError) || error.kind !== 'unauthorized') throw error;

    // Another request may have rotated the tokens a moment ago.
    const latest = await deps.store.loadConnection(userId);
    if (
      latest?.status === 'connected' &&
      latest.access_token_enc &&
      latest.refresh_token_enc !== connection.refresh_token_enc &&
      !needsRefresh(latest.token_expires_at, deps.now())
    ) {
      return { accessToken: await deps.cipher.decrypt(latest.access_token_enc), connection: latest };
    }

    // The athlete revoked access (or the refresh token is otherwise dead).
    await deps.store.markRevoked(userId);
    throw new StravaNotConnectedError('revoked');
  }
}
