// ---------------------------------------------------------------------------
// The rail-agnostic money-movement boundary. The deal state machine + ledger
// (core) never know whether a dollar moved over RTP/FedNow/ACH/card — they just
// record accounting truth. A PaymentRail EXECUTES the real-world transfer and
// reports its lifecycle (pending → settled / returned). PlaidRail is adapter #1;
// a card adapter (Stripe) slots in later behind the same interface.
// ---------------------------------------------------------------------------

export type RailKind = 'rtp' | 'fednow' | 'ach' | 'card';
export type TransferStatus = 'pending' | 'processing' | 'settled' | 'returned' | 'failed';
export type TransferDirection = 'fund_buyer' | 'payout_seller' | 'refund_buyer';

export interface TransferIntent {
  dealId: string;
  userId: string; // whose bank to debit (funding) or credit (payout/refund)
  amountCents: number;
  idempotencyKey: string; // dedupe — never double-charge / double-pay
}

export interface TransferResult {
  transferId: string; // provider reference
  rail: RailKind;
  status: TransferStatus; // instant rails (RTP/FedNow) may return 'settled' immediately; ACH returns 'pending'
  riskScore?: number; // 0..99 Signal-style ACH-return risk (funding only); undefined for irreversible rails
}

export interface PaymentRail {
  readonly name: string; // 'plaid' | 'fake' | ...
  /** Risk score for an ACH debit (Plaid Signal). undefined for irreversible rails (RTP/FedNow). Called BEFORE funding. */
  evaluateFundingRisk(i: TransferIntent): Promise<number | undefined>;
  initiateFunding(i: TransferIntent): Promise<TransferResult>;
  initiatePayout(i: TransferIntent): Promise<TransferResult>;
  initiateRefund(i: TransferIntent): Promise<TransferResult>;
  getStatus(transferId: string): Promise<TransferStatus>;

  // Card-on-file commitment (seller side). $0 validation at accept; an auth hold
  // when the seller heads out; capture only on a no-show. Stripe SetupIntent +
  // manual-capture PaymentIntent in a real card adapter.
  validateCard(userId: string): Promise<{ ok: boolean; last4: string }>;
  holdCommitment(userId: string, amountCents: number): Promise<{ holdId: string }>;
  captureHold(holdId: string): Promise<{ ok: boolean }>;
  releaseHold(holdId: string): Promise<void>;
}

/** Funding with a Signal risk score at or above this is declined up front. */
export const RISK_DECLINE_THRESHOLD = 75;
