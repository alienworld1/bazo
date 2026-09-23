import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  batchWindowStart,
  decodePublicBatch,
  deriveBatchAddress,
  lockBatchInstruction,
  MAX_BATCH_REQUESTS,
} from './batch';

const programAddress = address('6e35GBMnuKLhWCJe3qmzWuJbN9L6XCTMPvAx5hgXLagb');
const market = address('H83inusRWiShJZsVT3rTFXafo1wSCgb5HKTJEsM2LRgu');
const caller = address('4Z1WAbsiJTtopLfGvei6CA5ejy5fVxZgtSmmXrTRSPhe');
const key = (value: number) =>
  address(getBase58Decoder().decode(new Uint8Array(32).fill(value)));

describe('Batch wire contract', () => {
  it('derives one PDA per chain-time window', async () => {
    expect(batchWindowStart(91n, 45n)).toBe(90n);
    expect(batchWindowStart(134n, 45n)).toBe(90n);
    expect(await deriveBatchAddress(programAddress, market, 90n)).toBe(
      await deriveBatchAddress(programAddress, market, 90n),
    );
    expect(await deriveBatchAddress(programAddress, market, 90n)).not.toBe(
      await deriveBatchAddress(programAddress, market, 135n),
    );
  });

  it('rejects malformed account data and unordered lock sets', async () => {
    expect(decodePublicBatch(new Uint8Array(233), key(8))).toBeNull();
    await expect(
      lockBatchInstruction({
        programAddress,
        caller,
        market,
        batch: key(9),
        requests: [
          { request: key(2), escrow: key(6) },
          { request: key(1), escrow: key(7) },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      lockBatchInstruction({
        programAddress,
        caller,
        market,
        batch: key(9),
        requests: Array.from(
          { length: MAX_BATCH_REQUESTS + 1 },
          (_, index) => ({
            request: key(index + 1),
            escrow: key(index + 11),
          }),
        ),
      }),
    ).rejects.toThrow('invalid batch request set');
  });

  it('decodes a locked account with the Anchor option and vector layout', async () => {
    const data = new Uint8Array(233);
    const view = new DataView(data.buffer);
    data.set(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode('account:Batch'),
        ),
      ).slice(0, 8),
    );
    view.setUint16(8, 1, true);
    data.set(getAddressEncoder().encode(market), 10);
    view.setBigInt64(42, 90n, true);
    view.setBigInt64(50, 135n, true);
    view.setBigInt64(58, 45n, true);
    view.setBigInt64(66, 120n, true);
    view.setBigUint64(74, 42n, true);
    data[82] = 1;
    view.setBigUint64(83, 50n, true);
    view.setBigInt64(91, 255n, true);
    data[99] = 2;
    view.setUint32(100, 2, true);
    data.set(getAddressEncoder().encode(key(1)), 104);
    data.set(getAddressEncoder().encode(key(2)), 136);
    const batch = decodePublicBatch(data, key(9));
    expect(batch).toMatchObject({
      market,
      status: 'locked',
      windowStart: '90',
      lockSlot: '50',
      lockDeadline: '255',
      requests: [key(1), key(2)],
    });
  });

  it('fits the four-request lock in a legacy-size transaction', async () => {
    const requests = Array.from({ length: MAX_BATCH_REQUESTS }, (_, index) => ({
      request: key(index + 1),
      escrow: key(index + 11),
    }));
    const instruction = await lockBatchInstruction({
      programAddress,
      caller,
      market,
      batch: key(20),
      requests,
    });
    const message = appendTransactionMessageInstructions(
      [instruction],
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: '11111111111111111111111111111111',
          lastValidBlockHeight: 1n,
        },
        setTransactionMessageFeePayer(
          caller,
          createTransactionMessage({ version: 'legacy' }),
        ),
      ),
    );
    const bytes = Buffer.from(
      getBase64EncodedWireTransaction(compileTransaction(message)),
      'base64',
    );
    expect(bytes.length).toBe(641);
    expect(bytes.length).toBeLessThanOrEqual(1_232);
  });
});
