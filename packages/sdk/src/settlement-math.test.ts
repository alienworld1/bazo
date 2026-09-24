import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/settlement-quote.json';
import { quoteCharge } from './settlement-math';

describe('settlement quote charge', () => {
  it.each(vectors)('charges $rawStock raw stock at $multiplierBits', vector => {
    expect(
      quoteCharge({
        rawStock: BigInt(vector.rawStock),
        stockDecimals: vector.stockDecimals,
        multiplierBits: BigInt(vector.multiplierBits),
        rawPrice: BigInt(vector.rawPrice),
        priceExponent: vector.priceExponent,
        premiumBps: vector.premiumBps,
        quoteDecimals: vector.quoteDecimals,
      }),
    ).toBe(BigInt(vector.expectedCharge));
  });

  it('rejects a nonfinite multiplier and an unrepresentable charge', () => {
    const input = {
      rawStock: 1n,
      stockDecimals: 0,
      multiplierBits: 0x3ff0000000000000n,
      rawPrice: 1n,
      priceExponent: 0,
      premiumBps: 0,
      quoteDecimals: 0,
    };
    expect(() =>
      quoteCharge({ ...input, multiplierBits: 0x7ff0000000000000n }),
    ).toThrow();
    expect(() =>
      quoteCharge({
        ...input,
        rawStock: (1n << 64n) - 1n,
        rawPrice: (1n << 63n) - 1n,
      }),
    ).toThrow();
  });
});
