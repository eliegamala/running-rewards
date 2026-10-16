import { Redirect } from 'expo-router';

/**
 * Landing route for the Strava return deep link. On iOS the in-app browser session normally
 * captures the redirect itself; if the link opens the app directly instead, send the runner
 * to the Strava screen, which shows the server-confirmed status.
 */
export default function StravaCallbackScreen() {
  return <Redirect href="/strava" />;
}
