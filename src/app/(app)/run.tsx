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

import { Fonts, Spacing } from '@/constants/theme';
import { getSnapshot, startRun, stopOrphanedTracking, stopRun, subscribe } from '@/lib/run-tracker';

const MIN_PACE_DISTANCE_KM = 0.05; // pace is meaningless over the first few metres

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

function formatPace(elapsedSeconds: number, distanceKm: number) {
  if (distanceKm < MIN_PACE_DISTANCE_KM) return '--:--';
  const secondsPerKm = Math.round(elapsedSeconds / distanceKm);
  if (secondsPerKm >= 100 * 60) return '--:--';
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
}

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

const Palette = {
  light: {
    background: '#F6F2C8',
    card: '#FFFDF0',
    hero: '#2F5130',
    heroText: '#F6F2C8',
    heroMuted: 'rgba(246, 242, 200, 0.6)',
    accent: '#DCE85A',
    accentText: '#22381F',
    text: '#22381F',
    textMuted: '#6E7A5A',
  },
  dark: {
    background: '#121410',
    card: '#1D211A',
    hero: '#2F5130',
    heroText: '#F6F2C8',
    heroMuted: 'rgba(246, 242, 200, 0.6)',
    accent: '#DCE85A',
    accentText: '#1A2A17',
    text: '#F6F2C8',
    textMuted: '#9CA58A',
  },
} as const;

type StatCardProps = {
  label: string;
  value: string;
  unit: string;
  colors: (typeof Palette)['light' | 'dark'];
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
  const isStartingRef = useRef(false);

  // Re-render twice a second while running; time is derived from the start timestamp,
  // so the clock stays correct after the screen has been locked.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [isRunning]);

  // Clean up GPS left over from a previous session, and never leave it running
  // if the screen goes away mid-run.
  useEffect(() => {
    stopOrphanedTracking();
    return () => {
      stopRun();
    };
  }, []);

  const handleStartRun = async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showPermissionAlert(canAskAgain);
        return;
      }

      await startRun();
    } catch {
      Alert.alert(
        'Unable to start GPS',
        'Make sure Location Services are turned on in Settings, then try again.',
      );
    } finally {
      isStartingRef.current = false;
    }
  };

  const elapsedMs = run.startTime === null ? 0 : (run.endTime ?? now) - run.startTime;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const distanceKm = run.distanceMeters / 1000;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={[styles.wordmark, { color: colors.text }]}>RUN</Text>
          <View style={[styles.statusPill, { backgroundColor: colors.card }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.textMuted }]} />
            <Text style={[styles.statusText, { color: colors.textMuted }]}>
              {isRunning ? 'Running' : 'Ready'}
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
            <Text style={[styles.heroCaption, { color: colors.heroMuted }]}>Elapsed</Text>
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

        <Pressable
          onPress={isRunning ? stopRun : handleStartRun}
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
  startButtonText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
