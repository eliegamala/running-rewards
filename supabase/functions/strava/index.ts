/**
 * Authenticated Strava actions for the signed-in runner:
 *   connect    → returns Strava's authorize URL with a single-use, user-bound state
 *   status     → connection status (never tokens)
 *   sync       → fetches recent activities from Strava and records them idempotently
 *   disconnect → revokes access at Strava and removes the stored connection
 *
 * The caller is verified in code with Supabase Auth (config.toml sets verify_jwt = false).
 */
import {
  authenticatedUserId,
  ConfigError,
  createTokenStore,
  json,
  loadContext,
  logError,
  type ServerContext,
} from '../_shared/server.ts';
import { StravaApiError } from '../_shared/strava-api.ts';
import {
  buildAuthorizeUrl,
  generateState,
  isAllowedReturnUrl,
  isInSyncCooldown,
  normalizeActivity,
  secondsUntilRateLimitReset,
  sha256Hex,
  STATE_TTL_MS,
  SYNC_COOLDOWN_MS,
  SYNC_WINDOW_DAYS,
  type ActivityRecord,
} from '../_shared/strava-logic.ts';
import { getValidAccessToken, StravaNotConnectedError } from '../_shared/tokens.ts';

async function connect(ctx: ServerContext, userId: string, returnUrl: unknown) {
  if (!isAllowedReturnUrl(returnUrl, ctx.allowExpoGoReturn)) {
    return json({ error: 'invalid_return_url' }, 400);
  }
  const state = generateState();
  // One pending connection per user: replace any earlier unused state.
  await ctx.admin.from('strava_oauth_states').delete().eq('user_id', userId);
  const { error } = await ctx.admin.from('strava_oauth_states').insert({
    state_hash: await sha256Hex(state),
    user_id: userId,
    return_url: returnUrl,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error('Could not store OAuth state.');

  return json({
    authorizeUrl: buildAuthorizeUrl({ clientId: ctx.clientId, redirectUri: ctx.callbackUrl, state }),
  });
}

async function status(ctx: ServerContext, userId: string) {
  const { data, error } = await ctx.admin
    .from('strava_connections')
    .select('athlete_id, scope, status, connected_at, last_synced_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('Could not load Strava status.');
  if (!data) return json({ status: 'not_connected' });
  return json({
    status: data.status, // 'connected' | 'revoked'
    athleteId: data.athlete_id,
    scope: data.scope,
    connectedAt: data.connected_at,
    lastSyncedAt: data.last_synced_at,
  });
}

async function sync(ctx: ServerContext, userId: string) {
  const store = createTokenStore(ctx.admin);
  const now = Date.now();
  const { accessToken, connection } = await getValidAccessToken(userId, {
    store,
    api: ctx.api,
    cipher: ctx.cipher,
    now: () => now,
  });

  if (isInSyncCooldown(connection.last_synced_at, now)) {
    const retryAfter = Math.ceil(
      (SYNC_COOLDOWN_MS - (now - Date.parse(connection.last_synced_at!))) / 1000,
    );
    return json({ error: 'cooldown', retryAfter }, 429);
  }

  const after = Math.floor(now / 1000) - SYNC_WINDOW_DAYS * 24 * 60 * 60;
  let raw: unknown[];
  try {
    raw = await ctx.api.listActivities(accessToken, after, 50);
  } catch (error) {
    if (error instanceof StravaApiError && error.kind === 'unauthorized') {
      await store.markRevoked(userId);
      throw new StravaNotConnectedError('revoked');
    }
    throw error;
  }

  const activities = raw.map(normalizeActivity).filter((a): a is ActivityRecord => a !== null);
  if (activities.length > 0) {
    const { error } = await ctx.admin.rpc('record_strava_activities', {
      p_user_id: userId,
      p_athlete_id: connection.athlete_id,
      p_activities: activities,
    });
    if (error) throw new Error('Could not record Strava activities.');
  }
  await ctx.admin
    .from('strava_connections')
    .update({ last_synced_at: new Date(now).toISOString() })
    .eq('user_id', userId);

  return json({ synced: activities.length });
}

async function disconnect(ctx: ServerContext, userId: string) {
  const store = createTokenStore(ctx.admin);
  let revokedAtStrava = false;
  try {
    const { accessToken } = await getValidAccessToken(userId, {
      store,
      api: ctx.api,
      cipher: ctx.cipher,
      now: Date.now,
    });
    await ctx.api.revoke(accessToken);
    revokedAtStrava = true;
  } catch (error) {
    // Already revoked/not connected is fine; other failures are reported to the app.
    if (!(error instanceof StravaNotConnectedError)) logError('strava.disconnect.revoke', error);
    else revokedAtStrava = true;
  }
  // Activities are kept so a reconnect can never earn a second reward for the same run.
  await ctx.admin.from('strava_connections').delete().eq('user_id', userId);
  await ctx.admin.from('strava_oauth_states').delete().eq('user_id', userId);
  return json({ disconnected: true, revokedAtStrava });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let ctx: ServerContext;
  try {
    ctx = await loadContext();
  } catch (error) {
    logError('strava.config', error);
    return json({ error: 'not_configured' }, 500);
  }

  const userId = await authenticatedUserId(req, ctx.admin);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as { action?: string; returnUrl?: unknown };

  try {
    switch (body.action) {
      case 'connect':
        return await connect(ctx, userId, body.returnUrl);
      case 'status':
        return await status(ctx, userId);
      case 'sync':
        return await sync(ctx, userId);
      case 'disconnect':
        return await disconnect(ctx, userId);
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (error) {
    if (error instanceof StravaNotConnectedError) return json({ error: error.reason }, 409);
    if (error instanceof StravaApiError) {
      if (error.kind === 'rate_limited') {
        return json({ error: 'rate_limited', retryAfter: secondsUntilRateLimitReset(Date.now()) }, 429);
      }
      logError(`strava.${body.action}`, error);
      return json({ error: 'strava_unavailable' }, 502);
    }
    if (error instanceof ConfigError) {
      logError('strava.config', error);
      return json({ error: 'not_configured' }, 500);
    }
    logError(`strava.${body.action}`, error);
    return json({ error: 'server_error' }, 500);
  }
});
