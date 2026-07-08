import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Foreground notifications show a banner. (Remote push needs a dev build — Expo Go
// on SDK 54 can't receive it; see apps/app/README.md.)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask permission and return this device's Expo push token, or null (simulator,
 * Expo Go, permission denied, or no EAS projectId configured). Never throws.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null; // e.g. no projectId in Expo Go — real token arrives with a dev build
  }
}

export type NotificationData = Record<string, unknown>;

/** Subscribe to notification TAPS (user opened a push). Returns an unsubscribe fn. */
export function onNotificationTap(handler: (data: NotificationData) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    handler((r.notification.request.content.data ?? {}) as NotificationData);
  });
  return () => sub.remove();
}

/** Handle a tap that COLD-STARTED the app (notification opened before listeners existed). */
export async function consumeInitialNotificationTap(handler: (data: NotificationData) => void): Promise<void> {
  try {
    const r = await Notifications.getLastNotificationResponseAsync();
    if (r) handler((r.notification.request.content.data ?? {}) as NotificationData);
  } catch {
    /* ignore */
  }
}
