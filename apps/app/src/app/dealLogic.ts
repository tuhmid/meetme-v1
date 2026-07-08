// Deal-flow helpers and shared constants — pure logic, no component state.
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import type { Action, Deal, Role } from '../api';
import type { IconName, Tone } from '../ui';
import type { Theme } from '../theme/types';

// --- input masks / validation (US phone + USD amount) ---
export const phoneDigits = (v: string): string => v.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
export const formatPhone = (v: string): string => {
  const d = phoneDigits(v);
  if (d.length > 6) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
};
export const toE164 = (v: string): string => '+1' + phoneDigits(v);
export const phoneValid = (v: string): boolean => phoneDigits(v).length === 10;
export const centsFromInput = (v: string): number => parseInt(v.replace(/\D/g, '') || '0', 10); // cash-register style
export const formatMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`; // exact — never rounds to whole dollars

// mirror of core splitFee: buyer's fee share is capped at $4 so completing a
// deal always returns at least $1 of the $5 deposit
export const buyerFeeCents = (totalFeeCents: number): number => Math.min(Math.floor(totalFeeCents / 2), 400);
export const sellerFeeCents = (totalFeeCents: number): number => totalFeeCents - buyerFeeCents(totalFeeCents);
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);
export const gentle = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

// which action(s) the current role can take now (tiny client mirror of dealUx)
export function nextActions(deal: Deal, role: Role): Action[] {
  const s = deal.state;
  if (s === 'DRAFT' && role === 'seller') return [{ type: 'ACCEPT_TERMS' }];
  if (s === 'AGREED' && role === 'buyer') return [{ type: 'FUND' }];
  // Can't head out until the meetup (spot + time) is confirmed — that's what arrival runs on.
  if (s === 'ARMED') return deal.meetupConfirmed ? [{ type: 'HEAD_OUT', actor: role }] : [];
  if (s === 'EN_ROUTE') {
    // Arrival is auto-detected (geofence) — no manual "I've arrived". The second party
    // still taps their own head-out (for the seller this also places the card hold).
    const headedOut = role === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut;
    return headedOut ? [] : [{ type: 'HEAD_OUT', actor: role }];
  }
  // AT_MEETUP: the buyer's code auto-reveals (QR + 6-digit) — no manual "reveal" tap.
  if (s === 'CONFIRMING' && role === 'buyer') return [{ type: 'CONFIRM_RECEIVED' }];
  return [];
}
export function labelFor(a: Action, deal: Deal): string {
  switch (a.type) {
    case 'ACCEPT_TERMS': return 'Accept terms';
    case 'FUND': return `Accept & fund ${formatMoney(deal.amountCents + deal.commitmentCents)}`;
    case 'HEAD_OUT': return "I'm heading out";
    case 'ARRIVE': return "I've arrived";
    case 'REVEAL_CODE': return 'Reveal release code';
    case 'CONFIRM_RECEIVED': return "Confirm I've got it";
    default: return a.type;
  }
}
// natural leading icon for a primary action button (presentational only)
export function iconFor(a: Action): IconName | undefined {
  switch (a.type) {
    case 'ACCEPT_TERMS': return 'checkmark-circle';
    case 'FUND': return 'lock-closed';
    case 'HEAD_OUT': return 'walk';
    case 'ARRIVE': return 'location';
    case 'REVEAL_CODE': return 'key';
    case 'CONFIRM_RECEIVED': return 'checkmark';
    default: return undefined;
  }
}
// friendly one-liner shown as a banner when the deal moves to a new state
export function stateBanner(s: string): string {
  const m: Record<string, string> = {
    AGREED: 'Terms accepted — the buyer can fund.',
    ARMED: 'Funded — head to the meetup.',
    EN_ROUTE: 'On the way — share your location to meet up.',
    AT_MEETUP: 'You are both here — reveal and enter the code.',
    CONFIRMING: 'Code verified — the buyer confirms receipt.',
    RELEASED: 'Done — funds released.',
    REFUNDED: 'Refunded.',
    CANCELLED: 'Cancelled.',
    EXPIRED_NO_SHOW: 'Expired — someone did not show.',
  };
  return m[s] ?? `Now: ${s}`;
}

// states where the buyer's escrow is in (FUND arms the deal directly)
export const ESCROW_STATES = ['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'];

// deal state → Stepper index (terminal failure states are intentionally absent:
// the Stepper is hidden for them and the outcome Callout tells the story instead)
export const STEP_INDEX: Record<string, number> = {
  DRAFT: 0,
  AGREED: 1,
  FUNDED: 2, // defensive: the state no longer exists server-side
  ARMED: 2,
  EN_ROUTE: 2,
  AT_MEETUP: 2,
  CONFIRMING: 2,
  RELEASED: 3,
  DISPUTE_RESOLVED: 3,
};

// presence status line for the PresenceCard rows
export const presenceStatus = (arrived: boolean, headedOut: boolean, distanceM: number | null): string =>
  arrived ? 'arrived' : headedOut ? (distanceM != null ? `${distanceM} m away` : 'heading over') : 'not left yet';

// Whose move is it, and why it's safe — powers the guidance Callout on the deal screen.
export function turnGuidance(deal: Deal, role: Role, otherFirst: string, demoHint: string | null): { tone: Tone; kicker: string; title: string; body: string } | null {
  const s = deal.state;
  if (!['DRAFT', 'AGREED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(s)) return null;
  // Once funded, the shared task before heading out is agreeing on the meetup — either side can act.
  if (s === 'ARMED' && !deal.meetupConfirmed) {
    return { tone: 'primary', kicker: 'Your turn', title: 'Agree on where & when', body: 'Propose a meetup spot + time (or ASAP) below. Once you both confirm, you can head out.' };
  }
  const myTurn = nextActions(deal, role).length > 0 || (s === 'AT_MEETUP' && role === 'seller');
  if (myTurn) {
    let title = 'Your move';
    let body = '';
    if (s === 'DRAFT') { title = 'Review and accept the terms'; body = 'Nothing is charged until the buyer funds the escrow.'; }
    else if (s === 'AGREED') { title = 'Fund the escrow'; body = `${formatMoney(deal.amountCents)} item + $5 deposit. Complete the deal and ${formatMoney(deal.commitmentCents - buyerFeeCents(deal.totalFeeCents))} of it comes back — the rest is the fee, only ever kept on a completed deal.`; }
    else if (s === 'ARMED') {
      title = "Head out when you're ready";
      body = role === 'seller'
        ? `Funds are locked in escrow. A ${formatMoney(deal.commitmentCents)} hold on your card backs this meetup — only captured if you don't show.`
        : 'Funds are locked in escrow — nothing moves until the handoff.';
    }
    else if (s === 'EN_ROUTE') { title = "Head out — we'll track the rest"; body = 'Your live location shares once you head out, so check-in at the spot is automatic.'; }
    else if (s === 'AT_MEETUP' && role === 'buyer') { title = 'Show your release QR'; body = 'Check the item first — letting the seller scan it releases the money.'; }
    else if (s === 'AT_MEETUP' && role === 'seller') { title = "Scan the buyer's QR"; body = 'Scan it (or enter the 6-digit code) to confirm the buyer is releasing payment.'; }
    else if (s === 'CONFIRMING') { title = 'Confirm you got the item'; body = "This releases the payment to the seller — confirm only once it's in your hands."; }
    return { tone: 'primary', kicker: 'Your turn', title, body };
  }
  let body = "Hang tight — you're covered by escrow either way.";
  if (s === 'DRAFT') body = 'They need to accept the terms. Nothing has been charged yet.';
  else if (s === 'AGREED') body = "They're funding the escrow — you'll see it locked here the moment it lands.";
  else if (s === 'EN_ROUTE') body = "You've arrived — wait somewhere public until they get there.";
  else if (s === 'AT_MEETUP') body = role === 'seller'
    ? "Scan the QR the buyer is showing (or enter their 6-digit code) to release payment."
    : 'Show the seller your QR below. Nothing moves until you confirm you got the item.';
  else if (s === 'CONFIRMING') body = "Code verified — hand over the item now. If they don't confirm, funds auto-release within 60 minutes; you're protected.";
  return { tone: 'neutral', kicker: 'Waiting', title: `Waiting on ${otherFirst}`, body: demoHint ? `${body} ${demoHint}` : body };
}

// What concretely happened to the money — the terminal-state outcome Callout.
export function outcomeFor(deal: Deal, role: Role, otherFirst: string): { tone: Tone; kicker: string; title: string; body: string } | null {
  const price = formatMoney(deal.amountCents);
  const deposit = formatMoney(deal.commitmentCents);
  const buyerFee = buyerFeeCents(deal.totalFeeCents);
  const sellerFee = sellerFeeCents(deal.totalFeeCents);
  switch (deal.state) {
    case 'RELEASED':
      return role === 'buyer'
        ? { tone: 'success', kicker: 'Deal complete', title: 'Payment released', body: `You paid ${formatMoney(deal.amountCents + buyerFee)} all-in — ${price} to the seller, ${formatMoney(deal.commitmentCents - buyerFee)} of your ${deposit} deposit back.` }
        : { tone: 'success', kicker: 'Deal complete', title: 'You got paid', body: `You got ${formatMoney(deal.amountCents - sellerFee)} (${price} − ${formatMoney(sellerFee)} fee). Your ${deposit} hold was released.` };
    case 'DISPUTE_RESOLVED':
      return { tone: 'success', kicker: 'Resolved', title: 'Dispute resolved', body: deal.resolutionNote || 'A specialist reviewed the case and settled the funds.' };
    case 'REFUNDED':
      return role === 'buyer'
        ? { tone: 'neutral', kicker: 'Refunded', title: 'You got everything back', body: `${formatMoney(deal.amountCents + deal.commitmentCents)} was returned to you in full — price and deposit, no fees.` }
        : { tone: 'neutral', kicker: 'Refunded', title: 'Deal refunded', body: 'The buyer was refunded in full and any hold on your card was released. No money changed hands.' };
    case 'CANCELLED':
      return { tone: 'neutral', kicker: 'Cancelled', title: 'Deal cancelled', body: 'Anything already funded was returned in full.' };
    case 'EXPIRED_NO_SHOW': {
      const iArrived = role === 'buyer' ? deal.buyerArrived : deal.sellerArrived;
      const theyArrived = role === 'buyer' ? deal.sellerArrived : deal.buyerArrived;
      const comp = formatMoney(deal.commitmentCents - 100); // $4 to the stood-up party
      const body = iArrived && !theyArrived
        ? `${otherFirst} didn't show. ${comp} of their ${deposit} deposit was paid to you (MeetMe kept a $1 recovery fee), and anything you'd funded came back in full.`
        : !iArrived && theyArrived
          ? `You didn't make it, so ${comp} of your ${deposit} deposit went to ${otherFirst} (MeetMe kept a $1 recovery fee). Anything else you'd funded was returned.`
          : `Neither of you made it — everyone was refunded in full. No penalty, no fee.`;
      return { tone: 'warning', kicker: 'No-show', title: 'Deal expired', body };
    }
  }
  return null;
}

export const STATE_LABEL: Record<string, string> = {
  DRAFT: 'Draft', AGREED: 'Agreed', FUNDED: 'Funded', ARMED: 'Ready', EN_ROUTE: 'On the way',
  AT_MEETUP: 'At meetup', CONFIRMING: 'Confirming', RELEASED: 'Completed', CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded', EXPIRED_NO_SHOW: 'No-show', DISPUTED: 'Disputed', DISPUTE_RESOLVED: 'Resolved',
};

// Money movements in plain English — the UI should never show raw ledger enums.
const TRANSFER_LABEL: Record<string, string> = {
  fund_buyer: 'Funded escrow',
  payout_seller: 'Released to seller',
  refund_buyer: 'Refunded',
  payout_buyer: 'Paid to you',
  fee_capture: 'MeetMe fee',
};
const TRANSFER_STATUS: Record<string, string> = {
  pending: 'Processing', processing: 'Processing', settled: 'Done',
  returned: 'Returned', failed: 'Failed', canceled: 'Canceled', cancelled: 'Canceled',
};
export function describeTransfer(t: { direction: string; status: string }): { label: string; status: string; done: boolean; failed: boolean } {
  return {
    label: TRANSFER_LABEL[t.direction] ?? t.direction,
    status: TRANSFER_STATUS[t.status] ?? t.status,
    done: t.status === 'settled',
    failed: t.status === 'failed' || t.status === 'returned',
  };
}

// shared text-input look
export const inputStyle = (theme: Theme) => ({ backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: theme.type.size.md, marginBottom: theme.spacing.sm } as const);

// ---- meetup time helpers (null time = ASAP) ----
const atHour = (base: number, h: number): number => { const x = new Date(base); x.setHours(h, 0, 0, 0); return x.getTime(); };

/** The next ~6 days as picker chips (Today, Tomorrow, then weekday names), midnight-anchored
 *  so the chip's value is STABLE across renders (unlike a moving "in 1 hour"). */
export function dayOptions(now: number = Date.now()): { label: string; date: number }[] {
  const out: { label: string; date: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now + i * 86_400_000);
    d.setHours(0, 0, 0, 0);
    out.push({ label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short' }), date: d.getTime() });
  }
  return out;
}
export const TIME_OF_DAY: { label: string; hour: number }[] = [
  { label: 'Morning', hour: 9 }, { label: 'Midday', hour: 12 }, { label: 'Afternoon', hour: 15 }, { label: 'Evening', hour: 18 },
];
export const dayStartOf = (t: number): number => atHour(t, 0);
export const hourOf = (t: number): number => new Date(t).getHours();
export const combineDayHour = (dayMs: number, hour: number): number => atHour(dayMs, hour);

/** "ASAP" | "Today 3:00 PM" | "Tomorrow 9:00 AM" | "Jul 9, 3:00 PM". */
export function formatMeetupTime(t: number | null): string {
  if (t == null) return 'ASAP';
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === new Date(now.getTime() + 24 * 3_600_000).toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** "in 2h 15m" | "in 8m" | "now" | "12m ago". */
export function countdownTo(t: number, now: number = Date.now()): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.round((abs % 3_600_000) / 60_000);
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  if (diff < -60_000) return `${span} ago`;
  if (diff < 60_000) return 'now';
  return `in ${span}`;
}
