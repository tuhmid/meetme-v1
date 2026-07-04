// ---------------------------------------------------------------------------
// The deal state machine — the spine. A transition is legal only if listed in
// ALLOWED_TRANSITIONS. Validated in one place (the machine), server-side.
// ---------------------------------------------------------------------------

export type DealState =
  | 'DRAFT'
  | 'AGREED'
  | 'FUNDED'
  | 'ARMED'
  | 'EN_ROUTE'
  | 'AT_MEETUP'
  | 'CONFIRMING'
  | 'RELEASED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'EXPIRED_NO_SHOW'
  | 'DISPUTE_RESOLVED';

export const TERMINAL: ReadonlySet<DealState> = new Set<DealState>([
  'RELEASED',
  'CANCELLED',
  'REFUNDED',
  'EXPIRED_NO_SHOW',
  'DISPUTE_RESOLVED',
]);

export const isTerminal = (s: DealState): boolean => TERMINAL.has(s);

export const ALLOWED_TRANSITIONS: Record<DealState, DealState[]> = {
  DRAFT: ['AGREED', 'CANCELLED'],
  AGREED: ['FUNDED', 'CANCELLED'],
  FUNDED: ['ARMED', 'CANCELLED', 'REFUNDED'],
  ARMED: ['EN_ROUTE', 'DISPUTED', 'EXPIRED_NO_SHOW', 'CANCELLED', 'REFUNDED'],
  EN_ROUTE: ['AT_MEETUP', 'DISPUTED', 'EXPIRED_NO_SHOW'],
  AT_MEETUP: ['CONFIRMING', 'DISPUTED'],
  CONFIRMING: ['RELEASED', 'DISPUTED'],
  RELEASED: [],
  DISPUTED: ['DISPUTE_RESOLVED'],
  CANCELLED: [],
  REFUNDED: [],
  EXPIRED_NO_SHOW: [],
  DISPUTE_RESOLVED: [],
};

export const canTransition = (from: DealState, to: DealState): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);
