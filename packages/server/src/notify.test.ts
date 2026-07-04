import { describe, it, expect } from 'vitest';
import type { Deal } from '@meetme/core';
import { MemoryRepo } from './memoryRepo';
import { notifyDealState } from './notify';
import type { PushMessage, PushSender } from './pushExpo';

function fakeSender() {
  const sent: Array<{ tokens: string[]; msg: PushMessage }> = [];
  const sender: PushSender = { async send(tokens, msg) { sent.push({ tokens, msg }); } };
  return { sender, sent };
}

const deal = (state: Deal['state']): Deal => ({ id: 'd1', buyerId: 'maya', sellerId: 'sam', state } as any);

describe('M5 push notifications', () => {
  it('saves + dedupes push tokens per user', async () => {
    const repo = new MemoryRepo();
    await repo.savePushToken({ userId: 'maya', token: 'ExponentPushToken[a]' });
    await repo.savePushToken({ userId: 'maya', token: 'ExponentPushToken[a]' }); // dup
    await repo.savePushToken({ userId: 'maya', token: 'ExponentPushToken[b]' });
    await repo.savePushToken({ userId: 'sam', token: 'ExponentPushToken[c]' });
    expect((await repo.getPushTokens('maya')).sort()).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
    expect(await repo.getPushTokens('sam')).toEqual(['ExponentPushToken[c]']);
  });

  it('notifies BOTH parties with the state message', async () => {
    const repo = new MemoryRepo();
    const { sender, sent } = fakeSender();
    await repo.savePushToken({ userId: 'maya', token: 'ExponentPushToken[a]' });
    await repo.savePushToken({ userId: 'sam', token: 'ExponentPushToken[c]' });

    await notifyDealState(repo, sender, deal('AT_MEETUP'));
    expect(sent).toHaveLength(1);
    expect(sent[0].tokens.sort()).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[c]']);
    expect(sent[0].msg.title).toBe('You are both here');
    expect(sent[0].msg.data).toEqual({ dealId: 'd1', state: 'AT_MEETUP' });
  });

  it('sends nothing when no state message or no tokens', async () => {
    const repo = new MemoryRepo();
    const { sender, sent } = fakeSender();
    await notifyDealState(repo, sender, deal('AT_MEETUP')); // no tokens registered
    await repo.savePushToken({ userId: 'maya', token: 'ExponentPushToken[a]' });
    await notifyDealState(repo, sender, deal('DRAFT')); // no message for DRAFT
    expect(sent).toHaveLength(0);
  });
});
