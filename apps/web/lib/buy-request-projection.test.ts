import { describe, expect, it } from 'vitest';
import { BUY_REQUEST_ACCOUNT_DATA_LENGTH, decodePublicBuyRequest } from './buy-request-projection';

const discriminator = [175, 29, 113, 183, 180, 108, 205, 201];

describe('Buy Request account decoding', () => {
  it('reads status after the variable-width Batch lock', () => {
    const unlocked = accountData(0, 235, 1);
    const locked = accountData(1, 267, 1);
    expect(decodePublicBuyRequest(unlocked, 'request')?.status).toBe('active');
    expect(decodePublicBuyRequest(unlocked, 'request')?.lockedBatch).toBeNull();
    expect(decodePublicBuyRequest(locked, 'request')?.status).toBe('active');
    expect(decodePublicBuyRequest(locked, 'request')?.lockedBatch).toBeTruthy();
  });

  it('recognizes canceled and refunded custody states', () => {
    expect(decodePublicBuyRequest(accountData(0, 235, 2), 'request')?.status).toBe('canceled');
    expect(decodePublicBuyRequest(accountData(0, 235, 3), 'request')?.status).toBe('expired');
  });
});

function accountData(lockTag: number, statusOffset: number, status: number): Uint8Array {
  const data = new Uint8Array(BUY_REQUEST_ACCOUNT_DATA_LENGTH);
  data.set(discriminator, 0);
  new DataView(data.buffer).setUint16(8, 1, true);
  data[234] = lockTag;
  data[statusOffset] = status;
  return data;
}
