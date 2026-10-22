/**
 * Push notification messages and the Expo push API client. No Deno-specific APIs, `fetch`
 * is injectable, so this is unit-tested. Never logs tokens.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const BATCH_SIZE = 100;
/** Android notification channel created by the app. */
export const PUSH_CHANNEL_ID = 'rewards';

export type PushContent = {
  title: string;
  body: string;
  /** Opened in the app when the notification is tapped. */
  data: { kind: 'reward-unlocked' | 'strava-disconnected'; url: string; creditId?: string };
  /** Seconds the push may wait for an offline device before being dropped. */
  ttl: number;
};

function formatKm(distanceM: number) {
  return `${(Math.floor(distanceM / 100) / 10).toFixed(1)} km`;
}

/** "☕ Reward unlocked — 5.2 km run done…" for a Strava activity that earned a credit. */
export function rewardUnlockedPush(options: {
  creditId: string;
  distanceM: number | null;
  sportType: string | null;
  expiresAt: number;
  now: number;
}): PushContent {
  const activity = options.sportType === 'Walk' ? 'walk' : 'run';
  const done =
    options.distanceM !== null ? `${formatKm(options.distanceM)} ${activity} done.` : 'Run done.';
  return {
    title: '☕ Reward unlocked',
    body: `${done} Your reward is ready at any participating spot — use it within the hour.`,
    data: { kind: 'reward-unlocked', url: '/rewards', creditId: options.creditId },
    // Never deliver after the reward has expired.
    ttl: Math.max(0, Math.floor((options.expiresAt - options.now) / 1000)),
  };
}

export function stravaDisconnectedPush(): PushContent {
  return {
    title: 'Strava disconnected',
    body: 'Reconnect Strava to keep earning rewards from your runs.',
    data: { kind: 'strava-disconnected', url: '/strava' },
    ttl: 7 * 24 * 60 * 60,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PushResult = {
  /** Expo accepted the message for at least one device. */
  delivered: boolean;
  /** Tokens Expo says are no longer registered; stop sending to them. */
  invalidTokens: string[];
  /** The request failed (network/server); worth retrying later. */
  failed: boolean;
};

/** Sends one notification to every given device token via the Expo push service. */
export async function sendPush(
  tokens: string[],
  content: PushContent,
  fetchFn: FetchLike = fetch,
): Promise<PushResult> {
  const result: PushResult = { delivered: false, invalidTokens: [], failed: false };
  if (tokens.length === 0 || content.ttl <= 0) return result;

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const messages = batch.map((to) => ({
      to,
      title: content.title,
      body: content.body,
      data: content.data,
      sound: 'default',
      priority: 'high',
      channelId: PUSH_CHANNEL_ID,
      ttl: content.ttl,
    }));

    let tickets: { status?: string; details?: { error?: string } }[];
    try {
      const response = await fetchFn(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        await response.text().catch(() => undefined);
        result.failed = true;
        continue;
      }
      const body = (await response.json()) as { data?: typeof tickets };
      tickets = Array.isArray(body.data) ? body.data : [];
    } catch {
      result.failed = true;
      continue;
    }

    // Tickets come back in the same order as the messages.
    tickets.forEach((ticket, index) => {
      if (ticket?.status === 'ok') result.delivered = true;
      else if (ticket?.details?.error === 'DeviceNotRegistered') {
        result.invalidTokens.push(batch[index]);
      }
    });
  }
  return result;
}
