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
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);
export const gentle = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

// which action(s) the current role can take now (tiny client mirror of dealUx)
export function nextActions(deal: Deal, role: Role): Action[] {
  const s = deal.state;
  if (s === 'DRAFT' && role === 'seller') return [{ type: 'ACCEPT_TERMS' }];
  if (s === 'AGREED' && role === 'buyer') return [{ type: 'FUND' }];
  if (s === 'ARMED') return [{ type: 'HEAD_OUT', actor: role }];
  if (s === 'EN_ROUTE') {
    const arrived = role === 'buyer' ? deal.buyerArrived : deal.sellerArrived;
    if (arrived) return [];
    // The second party still signals their own head-out (for the seller this is
    // also what places the card hold) — arriving directly stays possible too.
    const headedOut = role === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut;
    return headedOut
      ? [{ type: 'ARRIVE', party: role }]
      : [{ type: 'HEAD_OUT', actor: role }, { type: 'ARRIVE', party: role }];
  }
  if (s === 'AT_MEETUP' && role === 'buyer' && !deal.codeRevealed) return [{ type: 'REVEAL_CODE' }];
  if (s === 'CONFIRMING' && role === 'buyer') return [{ type: 'CONFIRM_RECEIVED' }];
  return [];
}
export function labelFor(a: Action, deal: Deal): string {
  switch (a.type) {
    case 'ACCEPT_TERMS': return 'Accept terms';
    case 'FUND': return `Fund ${formatMoney(deal.amountCents + deal.feeCentsPerSide + deal.commitmentCents)}`;
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
  const myTurn = nextActions(deal, role).length > 0 || (s === 'AT_MEETUP' && role === 'seller');
  if (myTurn) {
    let title = 'Your move';
    let body = '';
    if (s === 'DRAFT') { title = 'Review and accept the terms'; body = 'Nothing is charged until the buyer funds the escrow.'; }
    else if (s === 'AGREED') { title = 'Fund the escrow'; body = `${formatMoney(deal.amountCents)} item + ${formatMoney(deal.feeCentsPerSide)} fee + ${formatMoney(deal.commitmentCents)} refundable commitment. MeetMe holds it all — the seller is only paid after you confirm the handoff.`; }
    else if (s === 'ARMED') {
      title = "Head out when you're ready";
      body = role === 'seller'
        ? `Funds are locked in escrow. Heading out places a ${formatMoney(deal.commitmentCents)} hold on your card — it's only captured if you don't show.`
        : 'Funds are locked in escrow — nothing moves until the handoff.';
    }
    else if (s === 'EN_ROUTE') { title = 'Tap arrive when you get there'; body = 'Share your live location on the way so you can find each other.'; }
    else if (s === 'AT_MEETUP' && role === 'buyer') { title = 'Reveal the release code'; body = 'Check the item first — the code is what releases the money.'; }
    else if (s === 'AT_MEETUP' && role === 'seller') { title = 'Enter the code the buyer shows you'; body = 'The code confirms the buyer is releasing the payment.'; }
    else if (s === 'CONFIRMING') { title = 'Confirm you got the item'; body = "This releases the payment to the seller — confirm only once it's in your hands."; }
    return { tone: 'primary', kicker: 'Your turn', title, body };
  }
  let body = "Hang tight — you're covered by escrow either way.";
  if (s === 'DRAFT') body = 'They need to accept the terms. Nothing has been charged yet.';
  else if (s === 'AGREED') body = "They're funding the escrow — you'll see it locked here the moment it lands.";
  else if (s === 'EN_ROUTE') body = "You've arrived — wait somewhere public until they get there.";
  else if (s === 'AT_MEETUP') body = 'Show them the code below. Nothing moves until you confirm you got the item.';
  else if (s === 'CONFIRMING') body = "Code verified — hand over the item now. If they don't confirm, funds auto-release within 60 minutes; you're protected.";
  return { tone: 'neutral', kicker: 'Waiting', title: `Waiting on ${otherFirst}`, body: demoHint ? `${body} ${demoHint}` : body };
}

// What concretely happened to the money — the terminal-state outcome Callout.
export function outcomeFor(deal: Deal, role: Role, otherFirst: string): { tone: Tone; kicker: string; title: string; body: string } | null {
  const total = formatMoney(deal.amountCents + deal.feeCentsPerSide + deal.commitmentCents);
  const price = formatMoney(deal.amountCents);
  const commit = formatMoney(deal.commitmentCents);
  switch (deal.state) {
    case 'RELEASED':
      return role === 'buyer'
        ? { tone: 'success', kicker: 'Deal complete', title: 'Payment released', body: `You paid ${total}. ${price} went to the seller and your ${commit} commitment came back.` }
        : { tone: 'success', kicker: 'Deal complete', title: 'You got paid', body: `${price} is on its way to you, and your ${commit} commitment came back.` };
    case 'DISPUTE_RESOLVED':
      return { tone: 'success', kicker: 'Resolved', title: 'Dispute resolved', body: deal.resolutionNote || 'A specialist reviewed the case and settled the funds.' };
    case 'REFUNDED':
      return role === 'buyer'
        ? { tone: 'neutral', kicker: 'Refunded', title: 'You got everything back', body: `${total} was returned to you in full.` }
        : { tone: 'neutral', kicker: 'Refunded', title: 'Deal refunded', body: `The buyer was refunded and your ${commit} commitment came back. No money changed hands.` };
    case 'CANCELLED':
      return { tone: 'neutral', kicker: 'Cancelled', title: 'Deal cancelled', body: 'Anything already funded was returned in full.' };
    case 'EXPIRED_NO_SHOW': {
      const iArrived = role === 'buyer' ? deal.buyerArrived : deal.sellerArrived;
      const theyArrived = role === 'buyer' ? deal.sellerArrived : deal.buyerArrived;
      const body = iArrived && !theyArrived
        ? `${otherFirst} didn't show. You were refunded in full, and their ${commit} commitment was forfeited.`
        : !iArrived && theyArrived
          ? `You didn't make it, so your ${commit} commitment was forfeited. Everything else was returned.`
          : `Nobody made it to the meetup. Commitments were forfeited and the rest was returned.`;
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

// shared text-input look
export const inputStyle = (theme: Theme) => ({ backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: theme.type.size.md, marginBottom: theme.spacing.sm } as const);
