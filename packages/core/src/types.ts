import type { Cents } from './money';
import type { DealState } from './states';

export type Role = 'buyer' | 'seller';
export type UseCase = 'marketplace' | 'friend';

export interface DisputePosition {
  actor: Role;
  text: string;
  at: number;
}

/**
 * The domain Deal. Escrow balances are NOT stored here — they live in the
 * ledger (double-entry). What's held is derivable from `state` + the locked
 * amounts, so the machine never trusts a denormalized balance.
 */
export interface Deal {
  id: string;
  buyerId: string;
  sellerId: string;
  useCase: UseCase;
  itemDescription: string;
  amountCents: Cents;
  feeCentsPerSide: Cents; // locked at create
  commitmentCents: Cents; // per side, locked at create
  state: DealState;
  releaseCodeHash: string | null; // hash only; plaintext never stored
  codeRevealed: boolean;
  buyerHeadedOut: boolean;
  sellerHeadedOut: boolean;
  buyerArrived: boolean;
  sellerArrived: boolean;
  meetupName: string | null; // agreed meetup spot
  meetupLat: number | null;
  meetupLng: number | null;
  meetupCustom: boolean; // true = user-entered (not a verified safe spot)
  faultParty: Role | null;
  resolutionNote: string | null;
  disputePositions: DisputePosition[];
  disputeProposals: { buyer?: DisputeOutcome; seller?: DisputeOutcome }; // self-service: agree → auto-resolve
  ratings: { buyer?: number; seller?: number };
}

export type DisputeOutcome = 'release' | 'refund' | 'split';

export interface DealEvent {
  at: number;
  actor: Role | 'system';
  type: string;
  note: string;
}

export type AccountRef = string; // 'escrow:<id>' | 'bank:<userId>' | 'platform:fees' | 'platform:penalty'

export interface LedgerEntry {
  txnId: string;
  account: AccountRef;
  amountCents: Cents; // signed; entries per txnId sum to 0
  dealId: string;
  memo: string;
}

/** Effects the server applies to user records / side tables (kept out of the deal/ledger). */
export type SideEffect =
  | { type: 'deal_completed'; userIds: [string, string] }
  | { type: 'trust_delta'; userId: string; delta: number }
  | { type: 'rating'; raterId: string; rateeId: string; stars: number }
  | { type: 'dispute_opened'; byUserId: string }
  | { type: 'dispute_position'; userId: string; actor: Role; text: string }
  | { type: 'dispute_proposal'; actor: Role; outcome: DisputeOutcome }
  | { type: 'dispute_resolved'; outcome: DisputeOutcome };

/**
 * Injected, side-effect-free context so the machine stays pure & deterministic
 * (testable; and IDs/codes come from the server, never a client counter).
 */
export interface Ctx {
  now: number;
  newTxnId: () => string;
  newCode: () => { code: string; hash: string };
  verifyCode: (hash: string | null, code: string) => boolean;
}

export type Action =
  | { type: 'ACCEPT_TERMS' }
  | { type: 'FUND' }
  | { type: 'POST_STAKE' }
  | { type: 'HEAD_OUT'; actor: Role }
  | { type: 'ARRIVE'; party: Role }
  | { type: 'CO_LOCATED' } // system: both phones detected together at the meetup
  | { type: 'SET_MEETUP'; actor: Role; name: string; lat: number; lng: number; custom: boolean }
  | { type: 'REVEAL_CODE' }
  | { type: 'ENTER_CODE'; code: string }
  | { type: 'CONFIRM_RECEIVED' }
  | { type: 'AUTO_RELEASE' }
  | { type: 'OPEN_DISPUTE'; actor: Role }
  | { type: 'SUBMIT_POSITION'; actor: Role; text: string }
  | { type: 'PROPOSE_RESOLUTION'; actor: Role; outcome: DisputeOutcome } // self-service
  | { type: 'RESOLVE_DISPUTE'; outcome: DisputeOutcome } // admin/support
  | { type: 'CANCEL'; actor: Role }
  | { type: 'EXPIRE_NO_SHOW'; noShow: Role }
  | { type: 'RATE'; actor: Role; stars: number };

export type ApplyResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      deal: Deal;
      events: DealEvent[];
      ledger: LedgerEntry[];
      effects: SideEffect[];
      /** Plaintext release code, returned at REVEAL_CODE for delivery to the BUYER only; never persisted. */
      secret?: { releaseCode: string };
    };
