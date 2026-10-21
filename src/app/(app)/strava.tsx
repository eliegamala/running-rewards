import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice, PrimaryButton, SecondaryButton, usePalette } from '@/components/auth-ui';
import { Fonts, Spacing, StravaBrand } from '@/constants/theme';
import { REWARD_DISTANCE_KM } from '@/lib/reward-credit';
import {
  canSeePrivateActivities,
  disconnectStrava,
  getStravaState,
  loadStravaActivities,
  refreshStravaStatus,
  subscribe as subscribeToStrava,
  syncStrava,
} from '@/lib/strava';

const STRAVA_TINT = { background: StravaBrand.orange, text: StravaBrand.onOrange };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const STATUS_LABELS = {
  connected: 'CONNECTED',
  not_connected: 'NOT CONNECTED',
  revoked: 'RECONNECT NEEDED',
  error: 'STATUS UNAVAILABLE',
  unknown: 'CHECKING…',
  unavailable: 'NOT AVAILABLE',
} as const;

/** Strava connection status and recent activities, all read from the server. */
export default function StravaScreen() {
  const colors = usePalette();
  const strava = useSyncExternalStore(subscribeToStrava, getStravaState);
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isConnected = strava.status === 'connected';

  useEffect(() => {
    void refreshStravaStatus();
  }, []);

  useEffect(() => {
    if (isConnected) void loadStravaActivities();
  }, [isConnected]);

  const sync = async () => {
    setBusy('sync');
    setMessage(null);
    const result = await syncStrava();
    setBusy(null);
    if (!result.ok) setMessage(result.message);
  };

  const confirmDisconnect = () =>
    Alert.alert(
      'Disconnect Strava?',
      'This removes the app’s access to your Strava account. You can connect again any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setBusy('disconnect');
            setMessage(null);
            const result = await disconnectStrava();
            setBusy(null);
            if (!result.ok) setMessage(result.message);
          },
        },
      ],
    );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.canvas }]}
      edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" onPress={() => router.navigate('/profile')} hitSlop={12}>
          <Text style={[styles.backText, { color: colors.textMuted }]}>‹ Profile</Text>
        </Pressable>

        <Text style={[styles.title, { color: colors.text }]}>
          Your <Text style={styles.serifItalic}>Strava</Text>
        </Text>

        <View style={[styles.statusCard, { backgroundColor: colors.hero }]}>
          <View
            style={[
              styles.statusChip,
              { backgroundColor: isConnected ? StravaBrand.orange : 'rgba(246, 242, 200, 0.14)' },
            ]}>
            <Text
              style={[
                styles.statusChipText,
                { color: isConnected ? StravaBrand.onOrange : colors.heroText },
              ]}>
              {STATUS_LABELS[strava.status]}
            </Text>
          </View>
          <Text style={[styles.statusDetail, { color: colors.heroText }]}>
            {isConnected
              ? `Connected ${formatDate(strava.connectedAt)}`
              : strava.status === 'revoked'
                ? 'Strava access was withdrawn.'
                : strava.status === 'error'
                  ? "Couldn't check your Strava status."
                  : 'Connect to sync your runs from Strava.'}
          </Text>
          {isConnected && strava.lastSyncedAt && (
            <Text style={[styles.statusMeta, { color: colors.heroMuted }]}>
              Last synced {formatDate(strava.lastSyncedAt)}
            </Text>
          )}
        </View>

        {isConnected && !canSeePrivateActivities(strava.scope) && (
          <Notice>Runs set to &quot;Only You&quot; on Strava aren&apos;t visible to the app.</Notice>
        )}
        {message && (
          <Notice title="STRAVA" tone="error">
            {message}
          </Notice>
        )}

        <View style={styles.actions}>
          {isConnected ? (
            <>
              <PrimaryButton
                label="SYNC NOW"
                onPress={sync}
                loading={busy === 'sync'}
                tint={STRAVA_TINT}
              />
              <SecondaryButton label="DISCONNECT" onPress={confirmDisconnect} />
            </>
          ) : strava.status === 'error' ? (
            <SecondaryButton
              label="TRY AGAIN"
              onPress={() => void refreshStravaStatus({ force: true })}
            />
          ) : strava.status !== 'unavailable' && strava.status !== 'unknown' ? (
            <PrimaryButton
              label="CONNECT STRAVA"
              onPress={() => router.push('/connect-strava')}
              tint={STRAVA_TINT}
            />
          ) : null}
        </View>

        {isConnected && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>LIVE FROM STRAVA</Text>
            <Text style={[styles.sectionNote, { color: colors.textMuted }]}>
              Your activities from the last 30 days. A recorded run or walk of{' '}
              {REWARD_DISTANCE_KM} km or more unlocks a reward when it syncs within 3 hours of
              finishing and you don&apos;t already have an active reward.
            </Text>

            {strava.activities === null ? (
              <ActivityIndicator style={styles.loader} color={colors.text} />
            ) : strava.activities.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: colors.surface }]}>
                <Text style={[styles.rowName, { color: colors.text }]}>No activities yet</Text>
                <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
                  Tap Sync now to fetch your recent Strava activities.
                </Text>
              </View>
            ) : (
              strava.activities.map((activity) => (
                <View
                  key={activity.activity_id}
                  style={[styles.row, { borderTopColor: colors.border }]}>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                      {activity.name ?? 'Untitled activity'}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
                      {[activity.sport_type, activity.is_manual ? 'Manual' : null, formatDate(activity.start_date)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={[styles.distance, { color: colors.text }]}>
                      {(activity.distance_m / 1000).toFixed(2)} km
                    </Text>
                    {activity.qualifies && (
                      <View style={[styles.pill, { backgroundColor: StravaBrand.orange }]}>
                        <Text style={[styles.pillText, { color: StravaBrand.onOrange }]}>
                          {activity.reward_decision === 'earned' ? 'REWARD EARNED' : 'QUALIFIES'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    fontSize: 44,
    fontWeight: '400',
    letterSpacing: -1.5,
    marginTop: Spacing.two,
  },
  statusCard: {
    borderRadius: 28,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  statusDetail: {
    fontSize: 20,
    fontWeight: '400',
  },
  statusMeta: {
    fontSize: 14,
  },
  actions: {
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: Spacing.four,
  },
  sectionNote: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: -Spacing.two,
  },
  loader: {
    marginTop: Spacing.four,
  },
  empty: {
    borderRadius: 24,
    padding: Spacing.four,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '500',
  },
  rowMeta: {
    fontSize: 14,
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  distance: {
    fontFamily: Fonts.rounded,
    fontSize: 17,
    fontWeight: '600',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
