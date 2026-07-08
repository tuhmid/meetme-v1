// Twilio SMS + Supabase "Send SMS" hook verification.
//
// Trial Twilio accounts can't create a Messaging Service or Verify service, so we can't
// use Supabase's built-in Twilio provider (it needs an MG... SID). Instead GoTrue calls
// our /auth/hooks/send-sms endpoint, and we send the code through the direct Messages API
// with a plain From number — which trials DO allow (to verified recipients).
import crypto from 'node:crypto';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string; // E.164, e.g. +17372583742
}

/** Send an SMS via Twilio's Messages API. Throws with Twilio's message on a non-2xx. */
export async function sendTwilioSms(cfg: TwilioConfig, to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: cfg.from, Body: body });
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`twilio ${res.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * Verify a Supabase "Send SMS" hook request (Standard Webhooks signing). `secret` is the
 * config's `secrets` value ("v1,whsec_<base64>"); GoTrue signs `${id}.${ts}.${body}` with
 * the base64-decoded key and sends it in the webhook-signature header. Constant-time compare.
 */
export function verifySendSmsHook(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string
): boolean {
  const id = str(headers['webhook-id']);
  const timestamp = str(headers['webhook-timestamp']);
  const sigHeader = str(headers['webhook-signature']);
  if (!id || !timestamp || !sigHeader || !secret) return false;

  const whsec = secret.split(',').map((s) => s.trim()).find((s) => s.startsWith('whsec_'));
  if (!whsec) return false;
  const key = Buffer.from(whsec.slice('whsec_'.length), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');

  // header is a space-delimited list of "v1,<sig>" — compare each signature part
  return sigHeader
    .split(' ')
    .map((s) => (s.includes(',') ? s.slice(s.indexOf(',') + 1) : s))
    .some((provided) => timingSafeEqual(provided, expected));
}

const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
