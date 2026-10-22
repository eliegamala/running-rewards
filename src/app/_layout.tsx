import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { NotificationTapHandler } from '@/components/notification-tap-handler';
import { RewardCelebration } from '@/components/reward-celebration';
import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
// Registers the background location task at startup, as TaskManager requires.
import '@/lib/run-tracker';
// Loads server rewards and starts queuing GPS reward claims before any run can begin.
import '@/lib/reward-credit';
// Reward notifications: foreground behaviour, reminders and push registration.
import '@/lib/notifications';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState);
  const canEnterApp = auth.status === 'signedIn' || auth.devPreview;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* Wait for a saved session to be restored, so returning runners skip Welcome. */}
      {auth.status !== 'loading' && (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!canEnterApp}>
            <Stack.Screen name="welcome" />
            <Stack.Screen name="sign-up" />
            <Stack.Screen name="log-in" />
            <Stack.Screen name="forgot-password" />
          </Stack.Protected>
          <Stack.Protected guard={canEnterApp}>
            <Stack.Screen name="(app)" />
            <Stack.Screen name="connect-strava" />
            <Stack.Screen name="strava-callback" />
            <Stack.Screen name="delete-account" />
          </Stack.Protected>
        </Stack>
      )}
      {canEnterApp && <RewardCelebration />}
      {canEnterApp && <NotificationTapHandler />}
    </ThemeProvider>
  );
}
