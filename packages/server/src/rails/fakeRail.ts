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
