import { describe, expect, it } from 'vitest';
import type { MarketConfig } from './markets';
import {
  canUseIndicativeBuyReference,
  confidenceRatioExceeds,
  evaluateReference,
} from './reference-policy';

const market: MarketConfig = {
  id: 'acme',
  symbol: 'ACME',
  displayName: 'Acme Holdings',
  network: 'devnet',
  stockMint: '11111111111111111111111111111111',
  stockTokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  quoteMint: '11111111111111111111111111111111',
  quoteTokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  quoteSymbol: 'USDC',
  tokenDecimals: 6,
  supportedStockExtensions: ['ScaledUiAmountConfig'],
  pythFeedId: '7',
  allowedSessions: ['regular'],
  maxReferenceAgeSeconds: 90,
  minPublisherCount: 3,
  maxConfidenceRatioBps: 100,
  minimumStageRawAmount: '1',
  batchDurationSeconds: 300,
  enabled: true,
};

function reference(
  overrides: Partial<Parameters<typeof evaluateReference>[0]> = {},
) {
  return {
    marketId: market.id,
    feedId: market.pythFeedId,
    price: '100000',
    exponent: -2,
    formattedPrice: '1000.00',
    confidence: '10',
    publisherCount: 4,
    marketSession: 'regular' as const,
    feedUpdateTimestamp: '1000',
    now: 1050,
    ...overrides,
  };
}

describe('reference policy', () => {
  it('accepts a fresh reference that satisfies all policy inputs', () => {
    expect(evaluateReference(reference(), market).status).toBe('valid');
  });

  it('uses deterministic precedence for feed mismatch and stale data', () => {
    expect(
      evaluateReference(reference({ feedId: 'wrong', now: 1200 }), market)
        .status,
    ).toBe('feed_mismatch');
    expect(evaluateReference(reference({ now: 1200 }), market).status).toBe(
      'stale',
    );
  });

  it('fails closed for sessions, publishers, and confidence', () => {
    expect(
      evaluateReference(reference({ marketSession: 'closed' }), market).status,
    ).toBe('closed');
    expect(
      evaluateReference(reference({ publisherCount: 2 }), market).status,
    ).toBe('insufficient_publishers');
    expect(
      evaluateReference(reference({ confidence: '1001' }), market).status,
    ).toBe('confidence_too_wide');
  });

  it('compares confidence with integers rather than floating point', () => {
    expect(confidenceRatioExceeds('1', '10000', 1)).toBe(false);
    expect(confidenceRatioExceeds('2', '10000', 1)).toBe(true);
  });

  it('allows a verified out-of-session price only for indicative buy quoting', () => {
    expect(
      canUseIndicativeBuyReference(
        evaluateReference(reference({ marketSession: 'overNight' }), market),
      ),
    ).toBe(true);
    expect(
      canUseIndicativeBuyReference(
        evaluateReference(
          reference({ marketSession: 'overNight', publisherCount: 2 }),
          market,
        ),
      ),
    ).toBe(false);
    expect(
      canUseIndicativeBuyReference(
        evaluateReference(
          reference({ marketSession: 'overNight', now: 1200 }),
          market,
        ),
      ),
    ).toBe(false);
    expect(
      canUseIndicativeBuyReference(
        evaluateReference(reference({ marketSession: 'closed' }), market),
      ),
    ).toBe(false);
  });
});
