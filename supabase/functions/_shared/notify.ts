/**
 * Sends the server's push notifications. Each "reward unlocked" push is handled exactly once
 * per credit (reward_credits.unlock_notified_at), so webhook retries and re-syncs never
 * notify twice. Failures never block reward processing.
 */
import { logError, type ServerContext } from './server.ts';
import { type PushContent, rewardUnlockedPush, sendPush, stravaDisconnectedPush } from './push.ts';

async function tokensFor(ctx: ServerContext, userId: string) {
  const { data } = await ctx.admin.from('push_tokens').select('token').eq('user_id', userId);
  return (data ?? []).map((row: { token: string }) => row.token);
}

async function send(ctx: ServerContext, userId: string, content: PushContent) {
  const tokens = await tokensFor(ctx, userId);
  const result = await sendPush(tokens, content);
  if (result.invalidTokens.length > 0) {
    await ctx.admin.from('push_tokens').delete().in('token', result.invalidTokens);
  }
  return { ...result, hadTokens: tokens.length > 0 };
}

/** Notifies the runner about Strava rewards that unlocked and haven't been announced yet. */
export async function notifyUnlockedRewards(ctx: ServerContext, userId: string) {
  try {
    const now = Date.now();
    const { data: credits } = await ctx.admin
      .from('reward_credits')
      .select('id, source_ref, expires_at')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .is('unlock_notified_at', null)
      .is('redeemed_at', null)
      .gt('expires_at', new Date(now).toISOString());

    for (const credit of credits ?? []) {
      // Claim the credit first (atomic), so concurrent syncs/webhooks can't both send.
      const { data: claimed } = await ctx.admin
        .from('reward_credits')
        .update({ unlock_notified_at: new Date().toISOString() })
        .eq('id', credit.id)
        .is('unlock_notified_at', null)
        .select('id')
        .maybeSingle();
      if (!claimed) continue;

      const { data: activity } = await ctx.admin
        .from('strava_activities')
        .select('distance_m, sport_type')
        .eq('activity_id', Number(credit.source_ref))
        .maybeSingle();

      const result = await send(
        ctx,
        userId,
        rewardUnlockedPush({
          creditId: credit.id,
          distanceM: activity?.distance_m ?? null,
          sportType: activity?.sport_type ?? null,
          expiresAt: Date.parse(credit.expires_at),
          now,
        }),
      );

      // Push service unreachable and nothing delivered: release the claim so a later sync
      // retries while the reward is still active.
      if (result.failed && result.hadTokens && !result.delivered) {
        await ctx.admin.from('reward_credits').update({ unlock_notified_at: null }).eq('id', credit.id);
      }
    }
  } catch (error) {
    logError('notify.unlocked', error);
  }
}

export async function notifyStravaDisconnected(ctx: ServerContext, userId: string) {
  try {
    await send(ctx, userId, stravaDisconnectedPush());
  } catch (error) {
    logError('notify.disconnected', error);
  }
}
