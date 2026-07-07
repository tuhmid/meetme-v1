import type { Deal } from '@meetme/core';
import type { PushSender } from './pushExpo';
import type { Repo } from './repo';

// One push message per meaningful deal state. We notify BOTH parties (each phone
// shows only what's relevant); the in-app banner covers the rest. Best-effort.
const MESSAGES: Record<string, { title: string; body: string }> = {
  AGREED: { title: 'Terms accepted', body: 'Your counterparty accepted — fund the deal to continue.' },
  ARMED: { title: 'Ready to meet', body: 'The deal is funded and armed. Head to the meetup spot.' },
  EN_ROUTE: { title: 'On the way', body: 'Your counterparty is heading to the meetup.' },
  AT_MEETUP: { title: 'You are both here', body: 'Reveal and enter the release code to finish.' },
  CONFIRMING: { title: 'Almost done', body: 'Release code verified — confirm you received the item.' },
  RELEASED: { title: 'Funds released', body: 'The deal is complete.' },
  EXPIRED_NO_SHOW: { title: 'Deal expired', body: 'A no-show ended the deal.' },
  REFUNDED: { title: 'Refunded', body: 'The deal was cancelled and refunded.' },
  DISPUTE_RESOLVED: { title: 'Dispute resolved', body: 'A resolution was applied to your deal.' },
};

/** Best-effort push to both parties for the deal's current state. Never throws. */
export async function notifyDealState(repo: Repo, push: PushSender, deal: Deal): Promise<void> {
  const msg = MESSAGES[deal.state];
  if (!msg) return;
  try {
    const tokens = [...(await repo.getPushTokens(deal.buyerId)), ...(await repo.getPushTokens(deal.sellerId))];
    if (tokens.length) await push.send(tokens, { title: msg.title, body: msg.body, data: { dealId: deal.id, state: deal.state } });
  } catch {
    /* best-effort */
  }
}
