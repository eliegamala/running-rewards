/**
 * Strava webhook endpoint (public; Strava calls it without a Supabase JWT).
 *
 * Strava does not sign events, so:
 *   - the callback URL carries a secret key (STRAVA_WEBHOOK_VERIFY_TOKEN) as its last path
 *     segment (…/strava-webhook/<key>), checked on GET and POST. A path segment is used because
 *     Strava appends its own query parameters to the callback URL;
 *   - the subscription id is checked when STRAVA_WEBHOOK_SUBSCRIPTION_ID is set;
 *   - events are only hints: activities are re-fetched from Strava with the owner's token
 *     before anything is recorded, so a forged event can't create an activity.
 * Events are acknowledged immediately (Strava requires 200 within 2 s) and processed in the
 * background. Duplicate deliveries are harmless because activity writes are idempotent.
 */
import { createTokenStore, json, loadContext, logError, text, type ServerContext } from '../_shared/server.ts';
import { StravaApiError } from '../_shared/strava-api.ts';
import { normalizeActivity, planWebhookEvent, safeEqual } from '../_shared/strava-logic.ts';
import { getValidAccessToken, StravaNotConnectedError } from '../_shared/tokens.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type StravaEvent = {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  subscription_id: number;
  updates?: Record<string, unknown>;
};

function parseEvent(body: unknown): StravaEvent | null {
  const e = body as StravaEvent;
  if (!e || typeof e !== 'object') return null;
  if (e.object_type !== 'activity' && e.object_type !== 'athlete') return null;
  if (!['create', 'update', 'delete'].includes(e.aspect_type)) return null;
  if (!Number.isSafeInteger(e.object_id) || !Number.isSafeInteger(e.owner_id)) return null;
  return e;
}

/** The key from …/strava-webhook/<key> (preferred) or ?key=<key>. */
function providedKey(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean);
  const index = segments.lastIndexOf('strava-webhook');
  if (index >= 0 && segments[index + 1]) return decodeURIComponent(segments[index + 1]);
  return url.searchParams.get('key') ?? '';
}

function hasValidKey(url: URL) {
  const expected = Deno.env.get('STRAVA_WEBHOOK_VERIFY_TOKEN');
  return !!expected && safeEqual(providedKey(url), expected);
}

async function processEvent(ctx: ServerContext, event: StravaEvent) {
  const { data: connection } = await ctx.admin
    .from('strava_connections')
    .select('user_id, athlete_id, status')
    .eq('athlete_id', event.owner_id)
    .maybeSingle();
  if (!connection) return; // Not one of our connected athletes.

  const store = createTokenStore(ctx.admin);

  const { data: stored } = await ctx.admin
    .from('strava_activities')
    .select('activity_id, deleted_at')
    .eq('activity_id', event.object_id)
    .eq('athlete_id', event.owner_id)
    .maybeSingle();
  const plan = planWebhookEvent(event, {
    exists: !!stored,
    deleted: !!stored?.deleted_at,
  });

  if (plan === 'skip') return; // Duplicate delivery, irrelevant change, or deleted activity.

  if (plan === 'revoke') {
    // The athlete removed the app on Strava: drop tokens and activity details.
    await store.markRevoked(connection.user_id);
    await ctx.admin.rpc('scrub_strava_activities', { p_user_id: connection.user_id });
    return;
  }

  if (plan === 'soft_delete') {
    // Soft delete: the id stays reserved so it can never earn a reward again.
    await ctx.admin
      .from('strava_activities')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('activity_id', event.object_id)
      .eq('athlete_id', event.owner_id);
    return;
  }

  if (plan === 'rename') {
    // The new title is in the event itself; no Strava request needed.
    await ctx.admin
      .from('strava_activities')
      .update({ name: String(event.updates?.title ?? '').slice(0, 200), updated_at: new Date().toISOString() })
      .eq('activity_id', event.object_id)
      .eq('athlete_id', event.owner_id);
    return;
  }

  // plan === 'fetch': new activity or changed type. Verify against Strava before recording.
  const { accessToken } = await getValidAccessToken(connection.user_id, {
    store,
    api: ctx.api,
    cipher: ctx.cipher,
    now: Date.now,
  });
  const raw = (await ctx.api.getActivity(accessToken, event.object_id)) as {
    athlete?: { id?: number };
  };
  if (raw?.athlete?.id !== event.owner_id) return; // Ownership mismatch: ignore.
  const activity = normalizeActivity(raw);
  if (!activity) return;

  const { error } = await ctx.admin.rpc('record_strava_activities', {
    p_user_id: connection.user_id,
    p_athlete_id: event.owner_id,
    p_activities: [activity],
  });
  if (error) throw new Error('Could not record webhook activity.');

  // Decide the reward right away: this is what makes "finish 5 km, reward unlocks" work.
  const { error: rewardError } = await ctx.admin.rpc('evaluate_strava_rewards', {
    p_user_id: connection.user_id,
  });
  if (rewardError) throw new Error('Could not evaluate Strava rewards.');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (!hasValidKey(url)) return text('Forbidden', 403);

  // Subscription validation handshake.
  if (req.method === 'GET') {
    const expected = Deno.env.get('STRAVA_WEBHOOK_VERIFY_TOKEN') ?? '';
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && challenge && safeEqual(token, expected)) {
      return json({ 'hub.challenge': challenge });
    }
    return text('Forbidden', 403);
  }

  if (req.method !== 'POST') return text('Method not allowed', 405);

  const event = parseEvent(await req.json().catch(() => null));
  if (!event) return text('Ignored', 200);

  const expectedSubscription = Deno.env.get('STRAVA_WEBHOOK_SUBSCRIPTION_ID');
  if (expectedSubscription && String(event.subscription_id) !== expectedSubscription) {
    return text('Ignored', 200);
  }

  const work = (async () => {
    try {
      await processEvent(await loadContext(), event);
    } catch (error) {
      // Not connected / revoked / not visible: nothing to record. Rate limits: the next
      // manual sync catches up. Only the error category is logged.
      if (error instanceof StravaNotConnectedError) return;
      if (error instanceof StravaApiError && error.kind === 'not_found') return;
      logError('strava-webhook.process', error);
    }
  })();

  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  else await work;

  return text('OK', 200);
});
