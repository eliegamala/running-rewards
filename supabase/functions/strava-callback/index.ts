/**
 * Strava OAuth redirect target (public: Strava's browser redirect carries no Supabase JWT).
 *
 * Security:
 *   - `state` must match a stored, unexpired hash; it is deleted on first use.
 *   - The Strava athlete is linked to the user who created that state, never to whoever
 *     happens to load this URL, and an athlete can only be linked to one account.
 *   - The code is exchanged here, server-side; tokens are encrypted before storage.
 *   - The browser is only ever sent back to the return URL stored with the state.
 */
import { loadContext, logError, text } from '../_shared/server.ts';
import {
  checkConsumedState,
  hasActivityReadScope,
  isWellFormedState,
  sha256Hex,
  withQuery,
  type StoredState,
} from '../_shared/strava-logic.ts';

const INVALID_LINK =
  'This Strava link is invalid or has expired. Return to the app and tap Connect Strava again.';

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return text('Method not allowed', 405);

  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  if (!isWellFormedState(state)) return text(INVALID_LINK, 400);

  let ctx;
  try {
    ctx = await loadContext();
  } catch (error) {
    logError('strava-callback.config', error);
    return text('Strava connection is not configured yet.', 500);
  }

  // Consume the state atomically: delete ... returning. A second use finds nothing.
  const { data: consumed } = await ctx.admin
    .from('strava_oauth_states')
    .delete()
    .eq('state_hash', await sha256Hex(state))
    .select('user_id, return_url, expires_at')
    .maybeSingle();

  const checked = checkConsumedState(consumed as StoredState | null, Date.now());
  if (!checked.ok) return text(INVALID_LINK, 400);

  const back = (params: Record<string, string>) => redirect(withQuery(checked.returnUrl, params));

  const stravaError = url.searchParams.get('error');
  if (stravaError) return back({ status: 'error', reason: stravaError === 'access_denied' ? 'denied' : 'failed' });

  const code = url.searchParams.get('code');
  if (!code) return back({ status: 'error', reason: 'failed' });
  if (!hasActivityReadScope(url.searchParams.get('scope'))) {
    return back({ status: 'error', reason: 'missing_scope' });
  }

  try {
    const tokens = await ctx.api.exchangeCode(code);
    const athleteId = tokens.athlete?.id;
    const grantedScope = tokens.scope ?? url.searchParams.get('scope') ?? '';
    if (typeof athleteId !== 'number' || !hasActivityReadScope(grantedScope)) {
      return back({ status: 'error', reason: typeof athleteId !== 'number' ? 'failed' : 'missing_scope' });
    }

    // One Strava athlete per app account.
    const { data: existing } = await ctx.admin
      .from('strava_connections')
      .select('user_id')
      .eq('athlete_id', athleteId)
      .maybeSingle();
    if (existing && existing.user_id !== checked.userId) {
      return back({ status: 'error', reason: 'athlete_in_use' });
    }

    const { error } = await ctx.admin.from('strava_connections').upsert(
      {
        user_id: checked.userId,
        athlete_id: athleteId,
        scope: grantedScope,
        access_token_enc: await ctx.cipher.encrypt(tokens.access_token),
        refresh_token_enc: await ctx.cipher.encrypt(tokens.refresh_token),
        token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
        status: 'connected',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      // e.g. a race where the athlete was linked elsewhere in the meantime (unique athlete_id).
      return back({ status: 'error', reason: error.code === '23505' ? 'athlete_in_use' : 'failed' });
    }

    return back({ status: 'connected' });
  } catch (error) {
    logError('strava-callback.exchange', error);
    return back({ status: 'error', reason: 'failed' });
  }
});
