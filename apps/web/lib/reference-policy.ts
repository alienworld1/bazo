import type {
  MarketConfig,
  NormalizedReference,
  ReferenceStatus,
} from './markets';

type ReferenceInput = Omit<
  NormalizedReference,
  'status' | 'reasons' | 'ageSeconds' | 'receivedAt'
> & {
  now?: number;
};

const FUTURE_TIMESTAMP_TOLERANCE_SECONDS = 30;

export function evaluateReference(
  input: ReferenceInput,
  market: MarketConfig,
): NormalizedReference {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const timestamp = Number(input.feedUpdateTimestamp);
  const reasons: string[] = [];
  const ageSeconds = Number.isFinite(timestamp)
    ? now - timestamp
    : Number.POSITIVE_INFINITY;
  let status: ReferenceStatus = 'valid';

  if (
    input.feedId !== market.pythFeedId ||
    !isFiniteIntegerString(input.price) ||
    !isFiniteIntegerString(input.confidence)
  ) {
    status = input.feedId !== market.pythFeedId ? 'feed_mismatch' : 'invalid';
    reasons.push(status);
  } else if (
    !Number.isFinite(timestamp) ||
    ageSeconds < -FUTURE_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    status = 'invalid';
    reasons.push('invalid_timestamp');
  } else if (ageSeconds > market.maxReferenceAgeSeconds) {
    status = 'stale';
    reasons.push('reference_too_old');
  } else if (input.publisherCount < market.minPublisherCount) {
    status = 'insufficient_publishers';
    reasons.push('publisher_count_too_low');
  } else if (
    confidenceRatioExceeds(
      input.confidence,
      input.price,
      market.maxConfidenceRatioBps,
    )
  ) {
    status = 'confidence_too_wide';
    reasons.push('confidence_ratio_too_wide');
  } else if (input.marketSession === 'closed') {
    status = 'closed';
    reasons.push('market_closed');
  } else if (
    input.marketSession === 'unknown' ||
    !market.allowedSessions.includes(input.marketSession)
  ) {
    status = 'session_not_allowed';
    reasons.push('session_not_allowed');
  }

  return {
    ...input,
    ageSeconds: Math.max(ageSeconds, 0),
    receivedAt: new Date().toISOString(),
    status,
    reasons,
  };
}

export function canUseIndicativeBuyReference(
  reference: NormalizedReference | undefined,
): reference is NormalizedReference {
  return Boolean(
    reference &&
    (reference.status === 'valid' ||
      (reference.status === 'session_not_allowed' &&
        reference.marketSession !== 'unknown')),
  );
}

export function confidenceRatioExceeds(
  confidence: string,
  price: string,
  maxBps: number,
): boolean {
  const absolutePrice = BigInt(price.startsWith('-') ? price.slice(1) : price);
  if (absolutePrice === BigInt(0)) return true;
  return BigInt(confidence) * BigInt(10_000) > absolutePrice * BigInt(maxBps);
}

function isFiniteIntegerString(value: string): boolean {
  return /^-?\d+$/.test(value);
}
