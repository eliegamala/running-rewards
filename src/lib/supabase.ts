/**
 * Supabase client, set up as in Expo's Supabase guide: sessions are stored with
 * expo-sqlite's `localStorage`, and token refresh pauses while the app is in the background.
 *
 * Configuration comes from `.env.local` (git-ignored). When it's missing or invalid,
 * `supabase` is null and the app reports that accounts aren't configured rather than
 * pretending anyone is signed in. Values are never logged.
 */
import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

// Must be read as static `process.env.EXPO_PUBLIC_*` expressions so Expo can inline them.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

// Legacy JWT-style keys carry their role; a service_role key is secret and must not ship.
function isServiceRoleJwt(key: string) {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'service_role';
  } catch {
    return false;
  }
}

/** Describes what's wrong with the configuration, without including any values. */
function findConfigProblem(): string | null {
  if (!supabaseUrl || !supabasePublishableKey) {
    return 'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not both set in .env.local.';
  }
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    if (url.pathname !== '/' && url.pathname !== '') {
      return 'EXPO_PUBLIC_SUPABASE_URL should be the Project URL only, like https://<project-ref>.supabase.co, with nothing after it.';
    }
  } catch {
    return 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL. It should look like https://<project-ref>.supabase.co';
  }
  if (supabasePublishableKey.startsWith('sb_secret_') || isServiceRoleJwt(supabasePublishableKey)) {
    return 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a secret key. Use the publishable key; secret keys must never be in the app.';
  }
  return null;
}

let configProblem = findConfigProblem();
let client: SupabaseClient | null = null;

if (!configProblem) {
  try {
    client = createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    configProblem = 'Supabase could not start. Check the URL and publishable key in .env.local.';
  }
}

/** Why accounts aren't available, or null when Supabase is configured. Contains no secrets. */
export const supabaseConfigProblem = configProblem;
export const isSupabaseConfigured = client !== null;
export const supabase = client;

if (client) {
  const configured = client;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') configured.auth.startAutoRefresh();
    else configured.auth.stopAutoRefresh();
  });
}
