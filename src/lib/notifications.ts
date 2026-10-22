/**
 * Reward notifications.
 *
 *   1. Reward unlocked (Strava)   — sent by the server as a push, even when the app is closed.
 *   2. Reward unlocked (GPS run)  — shown by the phone when a run passes 5 km in the background.
 *   3. 15 minutes left            — scheduled on the phone for the active, unredeemed reward.
 *   4. Strava disconnected        — sent by the server when access is removed on Strava.
 *
 * At most two notifications per reward; no marketing. Permission is only asked in context
 * (after connecting Strava, on the first run, or from Profile), never on launch.
 * Remote push needs a development build with an EAS project id; in Expo Go only the local
 * notifications (2 and 3) work, and push registration is skipped.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Linking, Platform } from 'react-native';

import { formatClockTime } from '@/hooks/use-reward-credit';
import { getAuthState, onBeforeLogOut, subscribe as subscribeToAuth } from '@/lib/auth';
import { readJson, writeJson } from '@/lib/local-json';
import { getRewardCredit, subscribe as subscribeToRewards } from '@/lib/reward-credit';
import { getStore } from '@/lib/stores';
import { supabase } from '@/lib/supabase';

const CHANNEL_ID = 'rewards';
const REMINDER_PREFIX = 'reward-expiring-';
const REMINDER_BEFORE_MS = 15 * 60 * 1000;
const TOKEN_NAME = 'push-token';
const ANNOUNCED_NAME = 'announced-rewards';

/** Screens a notification may open; anything else in push data is ignored. */
export const NOTIFICATION_ROUTES = ['/rewards', '/reward-pass', '/strava'] as const;
export type NotificationRoute = (typeof NOTIFICATION_ROUTES)[number];

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

// ---- Permission store (for the Profile row) ------------------------------------------------

let permission: NotificationPermission = 'undetermined';
const listeners = new Set<() => void>();

function setPermission(next: NotificationPermission) {
  if (next === permission) return;
  permission = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotificationPermission() {
  return permission;
}

function toPermission(status: Notifications.PermissionStatus): NotificationPermission {
  if (status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

// ---- Setup ------------------------------------------------------------------------------------

// In the foreground the in-app celebration already announces an unlock, so don't stack a
// banner on top; other notifications (reminder, Strava) show normally.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isUnlock = notification.request.content.data?.kind === 'reward-unlocked';
    return {
      shouldShowBanner: !isUnlock,
      shouldShowList: true,
      shouldPlaySound: !isUnlock,
      shouldSetBadge: false,
    };
  },
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Rewards',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function refreshPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    setPermission(toPermission(status));
  } catch {
    setPermission('unavailable');
  }
  return permission;
}

/** Asks for permission (shows the system prompt only if never asked). */
export async function requestNotificationPermission() {
  try {
    await ensureChannel(); // Android 13+ needs a channel before the prompt appears.
    const { status } = await Notifications.requestPermissionsAsync();
    setPermission(toPermission(status));
  } catch {
    setPermission('unavailable');
  }
  if (permission === 'granted') {
    void registerPushToken();
    void reconcileReminder();
  }
  return permission;
}

/** In-context ask: only prompts if the runner hasn't decided yet. */
export async function askForNotificationsInContext() {
  if ((await refreshPermission()) === 'undetermined') await requestNotificationPermission();
}

/** Profile row action: ask, or open Settings if previously declined. */
export async function openNotificationSettingsOrAsk() {
  if ((await refreshPermission()) === 'undetermined') await requestNotificationPermission();
  else void Linking.openSettings();
}

// ---- Remote push registration ---------------------------------------------------------------

function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

/** Whether this build can receive remote pushes at all (shown in Profile). */
export function canReceiveRemotePush() {
  return (
    Device.isDevice &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
    easProjectId() !== null
  );
}

async function registerPushToken() {
  const auth = getAuthState();
  const projectId = easProjectId();
  if (!supabase || auth.status !== 'signedIn' || !canReceiveRemotePush() || !projectId) return;
  if (permission !== 'granted') return;
  try {
    await ensureChannel();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (!error) writeJson(TOKEN_NAME, { token });
  } catch {
    // Offline or not available; retried on the next launch / foreground.
  }
}

onBeforeLogOut(async () => {
  const saved = readJson<{ token?: string } | null>(TOKEN_NAME, null);
  if (supabase && saved?.token) {
    await supabase.rpc('unregister_push_token', { p_token: saved.token });
  }
  writeJson(TOKEN_NAME, {});
  await cancelReminders();
});

// ---- Local notifications ------------------------------------------------------------------

async function cancelReminders(except?: string) {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(REMINDER_PREFIX) && n.identifier !== except)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    return scheduled;
  } catch {
    return [];
  }
}

/** Keeps exactly one "15 minutes left" reminder for the active, unredeemed reward. */
async function reconcileReminder() {
  const credit = getRewardCredit();
  const remindAt = credit.expiresAt !== null ? credit.expiresAt - REMINDER_BEFORE_MS : null;
  const wanted =
    permission === 'granted' &&
    credit.status === 'unlocked' &&
    credit.id !== null &&
    remindAt !== null &&
    remindAt > Date.now() + 5000
      ? `${REMINDER_PREFIX}${credit.id}-${credit.selectedStoreId ?? 'none'}`
      : undefined;

  const scheduled = await cancelReminders(wanted);
  if (!wanted || scheduled.some((n) => n.identifier === wanted)) return;

  const store = credit.selectedStoreId ? getStore(credit.selectedStoreId) : undefined;
  const at = formatClockTime(credit.expiresAt!);
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: wanted,
      content: {
        title: '⏳ 15 minutes left',
        body: store
          ? `Your reward at ${store.name} expires at ${at}. Show your pass at the counter.`
          : `Your reward expires at ${at}. Pick a spot before it's gone.`,
        data: { kind: 'reward-expiring', url: store ? '/reward-pass' : '/rewards' },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(remindAt!),
        channelId: CHANNEL_ID,
      },
    });
  } catch {
    // Scheduling failed (e.g. permission revoked meanwhile); nothing else to do.
  }
}

// GPS runs: announce an unlock that happens while the app is in the background (screen
// locked mid-run). Strava unlocks arrive as server pushes instead.
let announced = new Set(readJson<string[]>(ANNOUNCED_NAME, []));

function announceGpsUnlock() {
  const credit = getRewardCredit();
  if (credit.status !== 'unlocked' || !credit.id || announced.has(credit.id)) return;
  announced.add(credit.id);
  announced = new Set([...announced].slice(-20));
  writeJson(ANNOUNCED_NAME, [...announced]);
  if (credit.source !== 'gps' || AppState.currentState === 'active' || permission !== 'granted') {
    return; // In the app, the celebration shows instead.
  }
  void Notifications.scheduleNotificationAsync({
    content: {
      title: '☕ Reward unlocked',
      body: "5 km done. Your reward is ready — use it within the hour.",
      data: { kind: 'reward-unlocked', url: '/rewards' },
      sound: 'default',
    },
    trigger: null,
  }).catch(() => undefined);
}

// ---- Lifecycle -------------------------------------------------------------------------------

subscribeToRewards(() => {
  announceGpsUnlock();
  void reconcileReminder();
});

let lastUserId: string | null = null;
function onAuthChange() {
  const { userId } = getAuthState();
  if (userId === lastUserId) return;
  lastUserId = userId;
  if (userId) {
    void refreshPermission().then(() => {
      void registerPushToken();
      void reconcileReminder();
    });
  }
}
subscribeToAuth(onAuthChange);
onAuthChange();

AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  // The runner may have changed permission in Settings.
  void refreshPermission().then(() => {
    void registerPushToken();
    void reconcileReminder();
  });
});

/** Validates a route from notification data before navigating to it. */
export function routeFromNotification(data: unknown): NotificationRoute | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' && (NOTIFICATION_ROUTES as readonly string[]).includes(url)
    ? (url as NotificationRoute)
    : null;
}
