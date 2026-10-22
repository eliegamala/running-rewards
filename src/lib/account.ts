/**
 * Permanent account deletion via the `delete-account` Edge Function.
 *
 * The server deletes the account and everything stored for it. Only once it confirms does
 * this phone sign out and forget what it kept for that runner — never on a guess.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { getAuthState, logOut } from '@/lib/auth';
import { clearProfile } from '@/lib/profile';
import { forgetUserOnDevice } from '@/lib/reward-credit';
import { supabase } from '@/lib/supabase';

/** What the runner types to confirm; the server refuses the request without it. */
export const DELETE_CONFIRMATION = 'DELETE';

export function isDeleteConfirmed(typed: string) {
  return typed.trim().toUpperCase() === DELETE_CONFIRMATION;
}

export type DeleteAccountResult =
  /** stravaRevoked: false when Strava couldn't be reached to withdraw this app's access. */
  | { ok: true; stravaRevoked: boolean | null }
  | { ok: false; message: string };

function messageFor(error: string) {
  switch (error) {
    case 'network':
      return "Couldn't reach the server, so nothing was deleted. Check your connection and try again.";
    case 'unauthorized':
      return 'Your session has expired. Log out, log back in, and try again.';
    case 'not_configured':
      return "Account deletion isn't set up on the server yet. Nothing was deleted.";
    default:
      return 'Your account could not be deleted. Nothing was removed. Please try again.';
  }
}

export async function deleteAccount(typed: string): Promise<DeleteAccountResult> {
  const { status, userId } = getAuthState();
  if (!supabase || status !== 'signedIn' || !userId) {
    return { ok: false, message: 'You need to be signed in to delete your account.' };
  }
  if (!isDeleteConfirmed(typed)) {
    return { ok: false, message: `Type ${DELETE_CONFIRMATION} to confirm.` };
  }

  let data: { deleted?: unknown; stravaRevoked?: unknown } | null;
  try {
    const response = await supabase.functions.invoke('delete-account', {
      body: { confirm: DELETE_CONFIRMATION },
    });
    if (response.error) {
      const payload =
        response.error instanceof FunctionsHttpError
          ? await (response.error.context as Response).json().catch(() => null)
          : null;
      return {
        ok: false,
        message: messageFor(
          typeof payload?.error === 'string'
            ? payload.error
            : response.error instanceof FunctionsHttpError
              ? 'server_error'
              : 'network',
        ),
      };
    }
    data = response.data;
  } catch {
    return { ok: false, message: messageFor('network') };
  }
  if (data?.deleted !== true) return { ok: false, message: messageFor('server_error') };

  // The account is gone on the server: forget it on this phone and end the session here.
  forgetUserOnDevice(userId);
  clearProfile();
  await logOut({ scope: 'local' });
  return {
    ok: true,
    stravaRevoked: typeof data.stravaRevoked === 'boolean' ? data.stravaRevoked : null,
  };
}
