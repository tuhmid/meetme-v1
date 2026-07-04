import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Ctx } from '@meetme/core';

/** Server context: core's Ctx plus server-generated entity IDs. */
export interface ServerCtx extends Ctx {
  newId: () => string;
}

// NOTE: production should salt/pepper per-deal; this is the M1 shape.
const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

export function makeServerCtx(now: number = Date.now()): ServerCtx {
  return {
    now,
    newId: () => randomUUID(),
    newTxnId: () => randomUUID(),
    newCode: () => {
      const code = String(randomInt(1000, 10000)); // 4-digit
      return { code, hash: hashCode(code) };
    },
    verifyCode: (hash, code) => hash !== null && hashCode(code) === hash,
  };
}
