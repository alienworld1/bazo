import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSignedReference } from './signed-reference';

const signed = new Uint8Array(159);
new DataView(signed.buffer).setUint32(0, 2_182_742_457, true);
new DataView(signed.buffer).setUint16(100, 57, true);

const policy = {
  feedId: 1435n,
  allowedSessionMask: 1,
  maximumAgeSeconds: 90,
  minimumPublisherCount: 2,
  maximumConfidenceRatioBps: 100,
  chainTime: 100n,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('signed market reference', () => {
  it('accepts the Solana envelope in the current Pyth response shape', async () => {
    vi.stubEnv('PYTH_API_KEY', 'fixture-credential');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          parsed: {
            priceFeeds: [
              {
                priceFeedId: 1435,
                price: '100000',
                exponent: -3,
                confidence: '100',
                publisherCount: 2,
                marketSession: 'regular',
                feedUpdateTimestamp: '99000000',
              },
            ],
          },
          solana: {
            encoding: 'base64',
            data: Buffer.from(signed).toString('base64'),
          },
        }),
      })),
    );
    const result = await readSignedReference(policy);
    expect(result.bytes).toEqual(signed);
    expect(result.price).toBe(100000n);
    expect(result.sessionMask).toBe(1);
  });

  it('rejects a carried-forward timestamp even when the response arrived now', async () => {
    vi.stubEnv('PYTH_API_KEY', 'fixture-credential');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          parsed: {
            priceFeeds: [
              {
                priceFeedId: 1435,
                price: '100000',
                exponent: -3,
                confidence: '100',
                publisherCount: 2,
                marketSession: 'regular',
                feedUpdateTimestamp: '1000000',
              },
            ],
          },
          solana: {
            encoding: 'base64',
            data: Buffer.from(signed).toString('base64'),
          },
        }),
      })),
    );
    await expect(
      readSignedReference({ ...policy, maximumAgeSeconds: 10 }),
    ).rejects.toThrow('outside settlement policy');
  });
});
