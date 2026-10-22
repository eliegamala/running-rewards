import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { routeFromNotification } from '@/lib/notifications';

// Each notification is acted on once, even if this component remounts.
const handled = new Set<string>();

function open(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const id = response.notification.request.identifier;
  if (handled.has(id)) return;
  handled.add(id);
  const route = routeFromNotification(response.notification.request.content.data);
  if (route) router.navigate(route);
}

/** Opens the screen a notification points to, including one that launched the app. */
export function NotificationTapHandler() {
  useEffect(() => {
    let mounted = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (mounted) open(response);
      })
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return null;
}
