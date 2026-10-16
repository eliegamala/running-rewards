import { Redirect } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { TabBar } from '@/components/tab-bar';
import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import {
  getOnboardingRecords,
  needsStravaStep,
  subscribe as subscribeToOnboarding,
} from '@/lib/onboarding';
import { getStravaState, subscribe as subscribeToStrava } from '@/lib/strava';

/** The signed-in app: Home, Run, Rewards (plus the pass, Profile and Strava) behind the tab bar. */
export default function AppLayout() {
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState);
  const records = useSyncExternalStore(subscribeToOnboarding, getOnboardingRecords);
  const strava = useSyncExternalStore(subscribeToStrava, getStravaState);

  // New sign-ins see the Connect Strava step first, until they connect or skip it.
  if (needsStravaStep(records, auth.userId, strava.status)) {
    return <Redirect href="/connect-strava" />;
  }

  return <TabBar />;
}
