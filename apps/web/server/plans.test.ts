import { getBase58Encoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodePublicSellPlan } from '../lib/plan-projection';

const base58Encoder = getBase58Encoder();

describe('public Sell Plan decoding', () => {
  it('reads only the public Plan projection from validated account bytes', () => {
    const data = new Uint8Array(238);
    data.set([161, 231, 251, 119, 2, 12, 162, 2]);
    data.set(base58Encoder.encode('11111111111111111111111111111111'), 10);
    data.set(base58Encoder.encode('11111111111111111111111111111111'), 42);
    data.set(base58Encoder.encode('11111111111111111111111111111111'), 74);
    data.set(base58Encoder.encode('11111111111111111111111111111111'), 106);
    const view = new DataView(data.buffer);
    view.setBigUint64(138, 10_000_000n, true);
    view.setBigUint64(146, 7_500_000n, true);
    view.setUint16(178, 1, true);
    data.set(new Uint8Array(32).fill(7), 180);
    data[212] = 1;
    view.setBigInt64(213, 1_700_000_000n, true);
    view.setBigInt64(221, 1_700_086_400n, true);

    expect(decodePublicSellPlan(data, '11111111111111111111111111111111')).toMatchObject({
      owner: '11111111111111111111111111111111',
      market: '11111111111111111111111111111111',
      initialRawInventory: '10000000',
      remainingRawInventory: '7500000',
      currentStageIndex: 1,
      status: 'active',
      currentCommitmentFingerprint: '070707070707…07070707',
    });
  });

  it('rejects malformed account data', () => {
    expect(decodePublicSellPlan(new Uint8Array(238), 'not-a-plan')).toBeNull();
  });
});
