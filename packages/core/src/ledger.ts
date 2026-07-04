// ---------------------------------------------------------------------------
// Double-entry ledger helpers. Every money movement is a set of signed entries
// that sum to zero per transaction — so total money is conserved and provable.
// Escrow held for a deal is DERIVED from its state, never a stored balance.
// ---------------------------------------------------------------------------

import type { AccountRef, Deal, LedgerEntry } from './types';
import type { Cents } from './money';

export const escrowAcct = (dealId: string): AccountRef => `escrow:${dealId}`;
export const bankAcct = (userId: string): AccountRef => `bank:${userId}`;
export const PLATFORM_FEES: AccountRef = 'platform:fees';
export const PLATFORM_PENALTY: AccountRef = 'platform:penalty';

export const entry = (txnId: string, account: AccountRef, amountCents: Cents, dealId: string, memo: string): LedgerEntry => ({
  txnId,
  account,
  amountCents,
  dealId,
  memo,
});

/** Drop zero-amount legs so the ledger stays clean. */
export const nonZero = (entries: LedgerEntry[]): LedgerEntry[] => entries.filter((e) => e.amountCents !== 0);

/** True if every transaction's legs sum to zero. */
export function balanced(entries: LedgerEntry[]): boolean {
  const byTxn = new Map<string, number>();
  for (const e of entries) byTxn.set(e.txnId, (byTxn.get(e.txnId) ?? 0) + e.amountCents);
  for (const v of byTxn.values()) if (v !== 0) return false;
  return true;
}

export function balanceOf(entries: LedgerEntry[], account: AccountRef): Cents {
  return entries.reduce((s, e) => (e.account === account ? s + e.amountCents : s), 0);
}

export interface Held {
  amount: Cents;
  buyerFee: Cents;
  buyerCommitment: Cents;
  sellerCommitment: Cents;
}

/** What's currently in escrow for a deal, derived from its state. */
export function escrowHeld(deal: Deal): Held {
  const buyerHeld = ['FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state);
  const sellerHeld = ['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state);
  return {
    amount: buyerHeld ? deal.amountCents : 0,
    buyerFee: buyerHeld ? deal.feeCentsPerSide : 0,
    buyerCommitment: buyerHeld ? deal.commitmentCents : 0,
    sellerCommitment: sellerHeld ? deal.commitmentCents : 0,
  };
}

export const heldTotal = (h: Held): Cents => h.amount + h.buyerFee + h.buyerCommitment + h.sellerCommitment;
