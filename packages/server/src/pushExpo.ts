// Push delivery via Expo's push service. Kept behind a tiny interface so tests
// use a no-op / fake and never hit the network, and so a different provider can
// slot in later.

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSender {
  send(tokens: string[], msg: PushMessage): Promise<void>;
}

/** Does nothing — the default when no push provider is wired (unit tests, etc.). */
export const NoopPushSender: PushSender = { async send() {} };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t: string): boolean => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken');

/** Sends via Expo's push API. Best-effort: swallows network errors (never blocks a deal). */
export function makeExpoPushSender(): PushSender {
  return {
    async send(tokens: string[], msg: PushMessage): Promise<void> {
      const to = tokens.filter(isExpoToken);
      if (to.length === 0) return;
      const messages = to.map((t) => ({ to: t, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: 'default' }));
      try {
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(messages),
        });
      } catch {
        /* best-effort — a failed push must never fail the deal */
      }
    },
  };
}
