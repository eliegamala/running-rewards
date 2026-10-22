import * as Location from 'expo-location';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Palette, type PaletteColors, Spacing } from '@/constants/theme';
import { askForNotificationsInContext } from '@/lib/notifications';
import { formatDuration, formatPace } from '@/lib/run-format';
import {
  getActiveElapsedMs,
  getSnapshot,
  pauseRun,
  resumeRun,
  simulateDistanceForTesting,
  startRun,
  stopOrphanedTracking,
  stopRun,
  subscribe,
} from '@/lib/run-tracker';

function showPermissionAlert(canAskAgain: boolean) {
  const message =
    'RUN needs access to your location to measure distance and pace. ' +
    (canAskAgain
      ? 'Please allow location access to start a run.'
      : 'Turn on location access in Settings to start a run.');

  Alert.alert(
    'Location permission required',
    message,
    canAskAgain
      ? [{ text: 'OK' }]
      : [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
  );
}

type StatCardProps = {
  label: string;
  value: string;
  unit: string;
  colors: PaletteColors;
};

function StatCard({ label, value, unit, colors }: StatCardProps) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text
        style={[styles.statValue, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.statUnit, { color: colors.textMuted }]}>{unit}</Text>
    </View>
  );
}

export default function RunScreen() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const { width } = useWindowDimensions();

  // Scale the timer with screen width so it stays dominant on small and large iPhones.
  const timerSize = Math.min(Math.round(width * 0.26), 120);

  const run = useSyncExternalStore(subscribe, getSnapshot);
  const isRunning = run.isActive;
  const isPaused = run.isActive && run.isPaused;
  const isTicking = isRunning && !isPaused;
  // Prevents double taps from starting, pausing or stopping twice.
  const isBusyRef = useRef(false);

  // Re-render twice a second while running; time is derived from timestamps, so the clock
  // stays correct after the screen has been locked. It stops ticking while paused.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!isTicking) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 500);
    // Refresh straight away on resume so the clock doesn't briefly show a stale time.
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [isTicking]);

  // Clean up GPS left over from a previous session, and never leave it running
  // if the screen goes away mid-run.
  useEffect(() => {
    stopOrphanedTracking();
    return () => {
      stopRun();
    };
  }, []);

  const runExclusive = async (action: () => Promise<void>) => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    try {
      await action();
    } finally {
      isBusyRef.current = false;
    }
  };

  const handleStopRun = () => runExclusive(stopRun);

  const handlePauseResume = () =>
    runExclusive(async () => {
      if (!isPaused) {
        await pauseRun();
        return;
      }
      try {
        await resumeRun();
      } catch {
        Alert.alert(
          'Unable to resume GPS',
          'Make sure Location Services and location access are on, then try again.',
        );
      }
    });

  const handleStartRun = async () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showPermissionAlert(canAskAgain);
        return;
      }

      await startRun();
      void askForNotificationsInContext();
    } catch {
      Alert.alert(
        'Unable to start GPS',
        'Make sure Location Services are turned on in Settings, then try again.',
      );
    } finally {
      isBusyRef.current = false;
    }
  };

  const elapsedMs = getActiveElapsedMs(run, now);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const distanceKm = run.distanceMeters / 1000;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={[styles.wordmark, { color: colors.text }]}>RUN</Text>
          <View style={[styles.statusPill, { backgroundColor: colors.card }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.textMuted }]} />
            <Text style={[styles.statusText, { color: colors.textMuted }]}>
              {isPaused ? 'Paused' : isRunning ? 'Running' : 'Ready'}
            </Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={[styles.heroCard, { backgroundColor: colors.hero }]}>
            <View style={[styles.heroTag, { backgroundColor: colors.accent }]}>
              <Text style={[styles.heroTagText, { color: colors.accentText }]}>TIME</Text>
            </View>
            <Text
              style={[
                styles.timer,
                { color: colors.heroText, fontSize: timerSize, lineHeight: timerSize * 1.1 },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {formatDuration(elapsedSeconds)}
            </Text>
            <Text style={[styles.heroCaption, { color: colors.heroMuted }]}>
              {isPaused ? 'Paused' : 'Elapsed'}
            </Text>
          </View>

          <View style={styles.statsRow}>
            <StatCard label="Distance" value={distanceKm.toFixed(2)} unit="km" colors={colors} />
            <StatCard
              label="Pace"
              value={formatPace(elapsedSeconds, distanceKm)}
              unit="/km"
              colors={colors}
            />
          </View>
        </View>

        {isRunning && (
          <Pressable
            onPress={handlePauseResume}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume run' : 'Pause run'}
            style={({ pressed }) => [
              styles.pauseButton,
              isPaused
                ? { backgroundColor: colors.hero, borderColor: colors.hero }
                : { borderColor: colors.text },
              pressed && styles.startButtonPressed,
            ]}>
            <Text
              style={[styles.pauseButtonText, { color: isPaused ? colors.heroText : colors.text }]}>
              {isPaused ? 'RESUME RUN' : 'PAUSE RUN'}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={isRunning ? handleStopRun : handleStartRun}
          accessibilityRole="button"
          accessibilityLabel={isRunning ? 'Stop run' : 'Start run'}
          style={({ pressed }) => [
            styles.startButton,
            { backgroundColor: colors.accent },
            pressed && styles.startButtonPressed,
          ]}>
          <Text style={[styles.startButtonText, { color: colors.accentText }]}>
            {isRunning ? 'STOP RUN' : 'START RUN'}
          </Text>
        </Pressable>

        {/* TEMPORARY dev-only test control. Remove before release. */}
        {__DEV__ && isTicking && (
          <Pressable
            accessibilityRole="button"
            onPress={() => simulateDistanceForTesting(5000)}
            style={[styles.devButton, { borderColor: colors.textMuted }]}>
            <Text style={[styles.devButtonText, { color: colors.textMuted }]}>
              DEV · Simulate 5 km
            </Text>
          </Pressable>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
  },
  heroCard: {
    borderRadius: 32,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  heroTag: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroTagText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  timer: {
    fontFamily: Fonts.rounded,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
  },
  heroCaption: {
    fontSize: 15,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  statCard: {
    flex: 1,
    borderRadius: 24,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  statValue: {
    fontFamily: Fonts.rounded,
    fontSize: 40,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: Spacing.two,
  },
  statUnit: {
    fontSize: 15,
    fontWeight: '500',
  },
  startButton: {
    height: 68,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  devButton: {
    alignSelf: 'center',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  devButtonText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  pauseButton: {
    height: 56,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  pauseButtonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
