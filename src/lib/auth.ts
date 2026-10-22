/**
 * Authentication state for the whole app, backed only by Supabase Auth.
 *
 * `signedIn` is set exclusively from sessions Supabase confirms (restored session or an
 * auth state change), never from a local guess. Passwords are sent to Supabase and never
 * stored on the device.
 *
 * `devPreview` is a development-only way into the app while Supabase isn't configured.
 * It is not a sign-in: there is no user, email or session.
 */
import { isAuthError, isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  userId: string | null;
  email: string | null;
  devPreview: boolean;
};

let state: AuthState = {
  status: isSupabaseConfigured ? 'loading' : 'signedOut',
  userId: null,
  email: null,
  devPreview: false,
};
const listeners = new Set<() => void>();

function update(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function applySession(session: Session | null) {
  update(
    session
      ? { status: 'signedIn', userId: session.user.id, email: session.user.email ?? null }
      : { status: 'signedOut', userId: null, email: null },
  );
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthState() {
  return state;
}

if (supabase) {
  supabase.auth
    .getSession()
    .then(({ data }) => applySession(data.session))
    .catch(() => applySession(null));
  supabase.auth.onAuthStateChange((_event, session) => applySession(session));
}

export type AuthResult = { ok: true } | { ok: false; message: string };

const NOT_CONFIGURED: AuthResult = {
  ok: false,
  message: "Accounts aren't switched on yet. The app's Supabase connection still needs to be configured.",
};

function friendlyError(error: unknown): string {
  if (isAuthRetryableFetchError(error)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (isAuthError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'That email and password don’t match an account.';
      case 'email_not_confirmed':
        return 'Please confirm your email first. Check your inbox for the link we sent.';
      case 'user_already_exists':
        return 'An account with this email already exists. Try logging in instead.';
      case 'weak_password':
        return 'That password is too weak. Try a longer one with a mix of characters.';
      case 'email_address_invalid':
        return 'That email address doesn’t look right.';
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return 'Too many attempts. Please wait a minute and try again.';
      case 'signup_disabled':
      case 'email_provider_disabled':
        return 'Email sign-up is currently turned off.';
    }
    if (error.message) return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Creates an account. If Supabase requires email confirmation, there is no session yet
 * and `needsConfirmation` is true; the user is not signed in until they confirm and log in.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult | { ok: true; needsConfirmation: boolean }> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: friendlyError(error) };
    return { ok: true, needsConfirmation: data.session === null };
  } catch (error) {
    return { ok: false, message: friendlyError(error) };
  }
}

export async function logIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendlyError(error) };
    // The session arrives through onAuthStateChange, which moves the app to signed in.
    return { ok: true };
  } catch (error) {
    return { ok: false, message: friendlyError(error) };
  }
}

const beforeLogOutHooks = new Set<() => Promise<void>>();

/** Work that needs the session one last time (e.g. unregistering this device's push token). */
export function onBeforeLogOut(hook: () => Promise<void>) {
  beforeLogOutHooks.add(hook);
  return () => {
    beforeLogOutHooks.delete(hook);
  };
}

export async function logOut() {
  if (state.devPreview) {
    update({ devPreview: false });
    return;
  }
  if (!supabase) return;
  // Best effort, and never allowed to hold up signing out for more than 3 seconds.
  await Promise.race([
    Promise.allSettled([...beforeLogOutHooks].map((hook) => hook())),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  try {
    await supabase.auth.signOut();
  } finally {
    // Clear locally even if the network call fails, so the device is signed out.
    applySession(null);
  }
}

/** DEV ONLY: enter the app without an account while Supabase isn't configured. */
export function enterDevPreview() {
  if (__DEV__ && !isSupabaseConfigured) update({ devPreview: true });
}
