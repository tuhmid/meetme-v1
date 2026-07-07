import type { PaymentRail, RailKind, TransferIntent, TransferResult, TransferStatus } from './rail';

export interface FakeRailConfig {
  /** Funding rail to simulate. Default 'ach'. */
  fundingRail?: RailKind;
  /** If true (RTP/FedNow), funding returns 'settled' immediately; else 'pending'. */
  instantSettle?: boolean;
  /** Signal-style ACH-return risk score (0..99) to report on funding. */
  fundingRisk?: number;
}

/**
 * In-memory rail for local dev + tests. Deterministic: you choose instant
 * (RTP/FedNow) vs pending (ACH), the risk score, and can drive settlement /
 * returns manually to exercise the payout-settlement gate.
 */
export class FakeRail implements PaymentRail {
  readonly name = 'fake';
  private readonly cfg: Required<FakeRailConfig>;
  private seq = 0;
  readonly transfers = new Map<string, TransferResult>();

  constructor(cfg: FakeRailConfig = {}) {
    this.cfg = {
      fundingRail: cfg.fundingRail ?? 'ach',
      instantSettle: cfg.instantSettle ?? false,
      fundingRisk: cfg.fundingRisk ?? 5,
    };
  }

  async evaluateFundingRisk(_i: TransferIntent): Promise<number | undefined> {
    const irreversible = this.cfg.fundingRail === 'rtp' || this.cfg.fundingRail === 'fednow';
    return irreversible ? undefined : this.cfg.fundingRisk;
  }

  async initiateFunding(i: TransferIntent): Promise<TransferResult> {
    const irreversible = this.cfg.fundingRail === 'rtp' || this.cfg.fundingRail === 'fednow';
    const status: TransferStatus = this.cfg.instantSettle || irreversible ? 'settled' : 'pending';
    const res: TransferResult = {
      transferId: `fake_${++this.seq}`,
      rail: this.cfg.fundingRail,
      status,
      riskScore: irreversible ? undefined : this.cfg.fundingRisk,
    };
    this.transfers.set(res.transferId, res);
    return res;
  }

  async initiatePayout(i: TransferIntent): Promise<TransferResult> {
    const res: TransferResult = { transferId: `fake_${++this.seq}`, rail: 'rtp', status: 'settled' };
    this.transfers.set(res.transferId, res);
    return res;
  }

  async initiateRefund(i: TransferIntent): Promise<TransferResult> {
    const res: TransferResult = { transferId: `fake_${++this.seq}`, rail: this.cfg.fundingRail, status: 'settled' };
    this.transfers.set(res.transferId, res);
    return res;
  }

  async getStatus(transferId: string): Promise<TransferStatus> {
    return this.transfers.get(transferId)?.status ?? 'failed';
  }

  // --- card-on-file commitment (seller side) ---
  readonly holds = new Map<string, { userId: string; amountCents: number; status: 'held' | 'captured' | 'released' }>();

  async validateCard(_userId: string): Promise<{ ok: boolean; last4: string }> {
    return { ok: true, last4: '4242' }; // $0 validation always passes on the fake rail
  }

  async holdCommitment(userId: string, amountCents: number): Promise<{ holdId: string }> {
    const holdId = `hold_${++this.seq}`;
    this.holds.set(holdId, { userId, amountCents, status: 'held' });
    return { holdId };
  }

  async captureHold(holdId: string): Promise<{ ok: boolean }> {
    const h = this.holds.get(holdId);
    if (!h) return { ok: false };
    h.status = 'captured';
    return { ok: true }; // collection never fails on the fake rail
  }

  async releaseHold(holdId: string): Promise<void> {
    const h = this.holds.get(holdId);
    if (h && h.status === 'held') h.status = 'released';
  }

  // --- test/sim helpers (a real rail gets these via webhooks) ---
  settle(transferId: string): void {
    const t = this.transfers.get(transferId);
    if (t) t.status = 'settled';
  }
  returnTransfer(transferId: string): void {
    const t = this.transfers.get(transferId);
    if (t) t.status = 'returned';
  }
}
