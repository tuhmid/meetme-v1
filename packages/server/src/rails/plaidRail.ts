import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import type { PaymentRail, RailKind, TransferIntent, TransferResult, TransferStatus } from './rail';

// ---------------------------------------------------------------------------
// PlaidRail — the real money rail (Plaid Transfer + Signal).
//
// SCAFFOLD: the call SEQUENCE is real (Signal evaluate → authorization create →
// transfer create → transfer get), but request bodies are cast to `any` because
// the exact field set must be confirmed against the Plaid sandbox with your
// credentials. Before production you also need: the Link flow (client + server
// public_token→access_token exchange), encrypted access_token storage, and the
// Transfer webhook to drive settlement (see docs/m2-plaid-setup.md).
// ---------------------------------------------------------------------------

export interface PlaidBank {
  accessToken: string; // per-item, from Link exchange (store encrypted, server-only)
  accountId: string;
  legalName: string;
}

export interface PlaidRailConfig {
  clientId: string;
  secret: string;
  env?: 'sandbox' | 'production';
  /** Resolve a user's linked-bank tokens (from payment_methods / your secret store). */
  getBank: (userId: string) => Promise<PlaidBank>;
  fundingNetwork?: 'ach' | 'rtp';
  payoutNetwork?: 'ach' | 'rtp';
}

const usd = (cents: number): string => (cents / 100).toFixed(2);

function mapStatus(s: string): TransferStatus {
  switch (s) {
    case 'settled':
    case 'funds_available':
      return 'settled';
    case 'pending':
      return 'pending';
    case 'posted':
      return 'processing';
    case 'returned':
      return 'returned';
    default:
      return 'failed'; // cancelled / failed / unknown
  }
}

export function makePlaidRail(cfg: PlaidRailConfig): PaymentRail {
  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[cfg.env ?? 'sandbox'],
      baseOptions: { headers: { 'PLAID-CLIENT-ID': cfg.clientId, 'PLAID-SECRET': cfg.secret } },
    })
  );
  const fundingNet = cfg.fundingNetwork ?? 'ach';
  const payoutNet = cfg.payoutNetwork ?? 'ach';

  async function transfer(i: TransferIntent, type: 'debit' | 'credit', network: 'ach' | 'rtp'): Promise<TransferResult> {
    const bank = await cfg.getBank(i.userId);
    const auth = await client.transferAuthorizationCreate({
      access_token: bank.accessToken,
      account_id: bank.accountId,
      type,
      network,
      amount: usd(i.amountCents),
      ach_class: network === 'ach' ? 'ppd' : undefined,
      user: { legal_name: bank.legalName },
    } as any);
    const authorizationId = (auth.data as any).authorization.id;
    const created = await client.transferCreate({
      access_token: bank.accessToken,
      account_id: bank.accountId,
      authorization_id: authorizationId,
      description: `meetme ${i.dealId.slice(0, 8)}`,
      idempotency_key: i.idempotencyKey,
    } as any);
    const t = (created.data as any).transfer;
    return { transferId: t.id, rail: network as RailKind, status: mapStatus(t.status) };
  }

  return {
    name: 'plaid',

    async evaluateFundingRisk(i: TransferIntent): Promise<number | undefined> {
      if (fundingNet === 'rtp') return undefined; // RTP/FedNow are irreversible — no return risk
      const bank = await cfg.getBank(i.userId);
      const resp = await client.signalEvaluate({
        access_token: bank.accessToken,
        account_id: bank.accountId,
        client_transaction_id: i.idempotencyKey,
        amount: i.amountCents / 100,
      } as any);
      const score = (resp.data as any)?.scores?.bank_initiated_return_risk?.score;
      return typeof score === 'number' ? score : undefined;
    },

    initiateFunding: (i) => transfer(i, 'debit', fundingNet),
    initiatePayout: (i) => transfer(i, 'credit', payoutNet),
    initiateRefund: (i) => transfer(i, 'credit', fundingNet),

    async getStatus(transferId: string): Promise<TransferStatus> {
      const resp = await client.transferGet({ transfer_id: transferId });
      return mapStatus((resp.data as any).transfer.status);
    },
  };
}
