import { describe, expect, it } from 'vitest';
import {
  maxAffordableRawQuantity,
  quoteCapFromReference,
} from './quote-ceiling';

describe('quoteCapFromReference', () => {
  it('rounds the reference-relative quote obligation upward to a raw quote unit', () => {
    expect(
      quoteCapFromReference({
        targetRawQuantity: 1_000_000n,
        stockDecimals: 6,
        quoteDecimals: 6,
        referencePrice: '12345',
        referenceExponent: -2,
        premiumBps: 100,
      }),
    ).toBe(124_684_500n);
  });
  it('uses the current Scaled UI Amount multiplier without floating point rounding', () => {
    expect(
      quoteCapFromReference({
        targetRawQuantity: 1_000_000n,
        stockDecimals: 6,
        stockMultiplier: '1.25',
        quoteDecimals: 6,
        referencePrice: '12345',
        referenceExponent: -2,
        premiumBps: 100,
      }),
    ).toBe(155_855_625n);
  });
  it('finds the largest raw quantity fundable by one quote account', () => {
    const terms = {
      stockDecimals: 6,
      stockMultiplier: '1',
      quoteDecimals: 6,
      referencePrice: '100',
      referenceExponent: 0,
      premiumBps: 0,
    };
    expect(maxAffordableRawQuantity(100_000_000n, terms)).toBe(1_000_000n);
  });
});
