/**
 * Deno/Edge-runtime helpers: configuration from secrets, the server-side Supabase client,
 * caller authentication and the token store. Never logs secrets or tokens.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { createStravaApi, type StravaApi } from './strava-api.ts';
import { createTokenCipher, type TokenCipher } from './token-crypto.ts';
import type { ConnectionRow, TokenStore } from './tokens.ts';

export class ConfigError extends Error {
  constructor(readonly missing: string) {
    super(`Missing configuration: ${missing}`);
  }
}

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new ConfigError(name);
  return value;
}

/** Server secret key: the new SUPABASE_SECRET_KEYS dictionary, else the legacy service_role key. */
function supabaseSecretKey() {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, unknown>;
      if (typeof parsed.default === 'string') return parsed.default;
    } catch {
      // Fall through to the legacy key.
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new ConfigError('SUPABASE_SECRET_KEYS');
}

export type ServerContext = {
  admin: SupabaseClient;
  api: StravaApi;
  cipher: TokenCipher;
  clientId: string;
  /** https://<ref>.supabase.co/functions/v1/strava-callback — must match Strava's callback domain. */
  callbackUrl: string;
  allowExpoGoReturn: boolean;
};

export async function loadContext(): Promise<ServerContext> {
  const supabaseUrl = required('SUPABASE_URL');
  const clientId = required('STRAVA_CLIENT_ID');
  const clientSecret = required('STRAVA_CLIENT_SECRET');
  const cipher = await createTokenCipher(required('STRAVA_TOKEN_ENCRYPTION_KEY'));
  return {
    admin: createClient(supabaseUrl, supabaseSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    api: createStravaApi({ clientId, clientSecret }),
    cipher,
    clientId,
    callbackUrl: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/strava-callback`,
    allowExpoGoReturn: Deno.env.get('STRAVA_ALLOW_EXPO_GO_RETURN') === 'true',
  };
}

/** Verifies the caller's Supabase session with Supabase Auth and returns their user id. */
export async function authenticatedUserId(req: Request, admin: SupabaseClient) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export function createTokenStore(admin: SupabaseClient): TokenStore {
  return {
    async loadConnection(userId) {
      const { data, error } = await admin
        .from('strava_connections')
        .select(
          'user_id, athlete_id, scope, access_token_enc, refresh_token_enc, token_expires_at, status, last_synced_at',
        )
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error('Could not load Strava connection.');
      return data as ConnectionRow | null;
    },
    async saveTokens(userId, tokens) {
      const { error } = await admin
        .from('strava_connections')
        .update({ ...tokens, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) throw new Error('Could not save refreshed Strava tokens.');
    },
    async markRevoked(userId) {
      await admin
        .from('strava_connections')
        .update({
          status: 'revoked',
          access_token_enc: null,
          refresh_token_enc: null,
          token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    },
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Plain text: hosted Edge Functions don't serve HTML pages on the default domain. */
export function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Logs an error category only — never request bodies, tokens or secrets. */
export function logError(where: string, error: unknown) {
  const kind =
    error instanceof ConfigError
      ? `config:${error.missing}`
      : error instanceof Error
        ? error.constructor.name
        : 'unknown';
  console.error(`[${where}] ${kind}`);
}
