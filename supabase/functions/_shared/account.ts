/**
 * Permanent account deletion.
 *
 * Order matters: the Strava token is read first (the connection row disappears with the
 * user). Stored files (profile photos) are removed next, because Storage doesn't cascade
 * with the user; if that fails, nothing else is deleted. Then the Supabase Auth user is
 * deleted — which removes every row that belongs to them, as all user tables cascade — and
 * only then is access revoked at Strava. A Strava problem never blocks deletion.
 */
import type { StravaApi } from './strava-api.ts';
import type { TokenCipher } from './token-crypto.ts';
import { getValidAccessToken, StravaNotConnectedError, type TokenStore } from './tokens.ts';

/** The app sends this only after the runner typed it on the confirmation screen. */
export const DELETE_CONFIRMATION = 'DELETE';

export type AccountDeletionDeps = {
  store: TokenStore;
  api: Pick<StravaApi, 'refresh' | 'revoke'>;
  cipher: TokenCipher;
  now: () => number;
  removeUserFiles(userId: string): Promise<{ ok: boolean }>;
  deleteUser(userId: string): Promise<{ ok: boolean }>;
  logError(where: string, error: unknown): void;
};

export type AccountDeletionResult =
  /** stravaRevoked: null when Strava was never connected (or access was already withdrawn). */
  | { deleted: true; stravaRevoked: boolean | null }
  | { deleted: false; error: 'confirmation_required' | 'delete_failed' };

export async function deleteAccount(
  userId: string,
  confirmation: unknown,
  deps: AccountDeletionDeps,
): Promise<AccountDeletionResult> {
  if (confirmation !== DELETE_CONFIRMATION) return { deleted: false, error: 'confirmation_required' };

  let stravaToken: string | null = null;
  let stravaRevoked: boolean | null = null;
  try {
    stravaToken = (await getValidAccessToken(userId, deps)).accessToken;
  } catch (error) {
    if (!(error instanceof StravaNotConnectedError)) {
      deps.logError('account.delete.strava_token', error);
      stravaRevoked = false;
    }
  }

  if (!(await deps.removeUserFiles(userId)).ok) return { deleted: false, error: 'delete_failed' };
  if (!(await deps.deleteUser(userId)).ok) return { deleted: false, error: 'delete_failed' };

  if (stravaToken) {
    try {
      await deps.api.revoke(stravaToken);
      stravaRevoked = true;
    } catch (error) {
      deps.logError('account.delete.strava_revoke', error);
      stravaRevoked = false;
    }
  }
  return { deleted: true, stravaRevoked };
}
