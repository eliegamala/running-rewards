import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';

import { AuthScreen, Notice, PrimaryButton, SecondaryButton } from '@/components/auth-ui';
import { StravaBrand } from '@/constants/theme';
import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import { askForNotificationsInContext } from '@/lib/notifications';
import { finishStravaStep } from '@/lib/onboarding';
import { REWARD_DISTANCE_KM } from '@/lib/reward-credit';
import { connectStrava, getStravaState, subscribe as subscribeToStrava } from '@/lib/strava';

/**
 * Onboarding step between sign-in and Home, also reachable later from Profile → Strava.
 * Reports success only when the server confirms the Strava connection.
 */
export default function ConnectStravaScreen() {
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState);
  const strava = useSyncExternalStore(subscribeToStrava, getStravaState);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const leave = () => {
    if (auth.userId) finishStravaStep(auth.userId);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const connect = async () => {
    setConnecting(true);
    setMessage(null);
    const result = await connectStrava();
    setConnecting(false);
    if (result.ok) {
      await askForNotificationsInContext();
      leave();
    }
    else if (!result.cancelled) setMessage(result.message);
  };

  if (strava.status === 'unavailable') {
    return (
      <AuthScreen lead="Connect" accent="Strava." intro="Strava needs a signed-in account.">
        <Notice title="NOT AVAILABLE IN PREVIEW">
          Sign in with a real account to connect Strava.
        </Notice>
        <SecondaryButton label="CONTINUE" onPress={leave} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      lead="Connect"
      accent="Strava."
      intro={`Keep tracking runs in Strava. We only ask to read your activities, so we can spot qualifying ${REWARD_DISTANCE_KM} km runs and walks.`}>
      {strava.status === 'revoked' && (
        <Notice title="RECONNECT NEEDED">
          Strava access was withdrawn. Connect again to keep your runs in sync.
        </Notice>
      )}
      {message && (
        <Notice title="NOT CONNECTED" tone="error">
          {message}
        </Notice>
      )}
      <PrimaryButton
        label="CONNECT STRAVA"
        onPress={connect}
        loading={connecting}
        tint={{ background: StravaBrand.orange, text: StravaBrand.onOrange }}
      />
      <SecondaryButton label="SKIP FOR NOW" onPress={leave} />
    </AuthScreen>
  );
}
