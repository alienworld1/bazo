import { describe, expect, it } from 'vitest';
import { quoteCapFromReference } from './quote-ceiling';

describe('quoteCapFromReference', () => {
  it('rounds the reference-relative quote obligation upward to a raw quote unit', () => {
    expect(quoteCapFromReference({ targetRawQuantity: 1_000_000n, stockDecimals: 6, quoteDecimals: 6, referencePrice: '12345', referenceExponent: -2, premiumBps: 100 })).toBe(124_684_500n);
  });
});
