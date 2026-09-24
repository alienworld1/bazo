const SESSION_MASK: Record<string, number> = {
  regular: 1,
  preMarket: 2,
  postMarket: 4,
  overNight: 8,
};

export type SignedReference = {
  bytes: Uint8Array;
  price: bigint;
  exponent: number;
  confidence: bigint;
  publisherCount: number;
  sessionMask: number;
  feedUpdateTimestampUs: bigint;
};

export async function readSignedReference(input: {
  feedId: bigint;
  allowedSessionMask: number;
  maximumAgeSeconds: number;
  minimumPublisherCount: number;
  maximumConfidenceRatioBps: number;
  chainTime: bigint;
}): Promise<SignedReference> {
  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) throw new Error('signed reference unavailable');
  if (input.feedId > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('feed identifier cannot be requested precisely');
  const response = await fetch(
    'https://pyth-lazer.dourolabs.app/v1/latest_price',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priceFeedIds: [Number(input.feedId)],
        properties: [
          'price',
          'exponent',
          'confidence',
          'publisherCount',
          'marketSession',
          'feedUpdateTimestamp',
        ],
        formats: ['solana'],
        channel: 'fixed_rate@1000ms',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) throw new Error('signed reference unavailable');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object')
    throw new Error('signed reference unavailable');
  const result = payload as Record<string, unknown>;
  const parsed = result.parsed as { priceFeeds?: unknown[] } | undefined;
  const feed = parsed?.priceFeeds?.[0] as Record<string, unknown> | undefined;
  const signed = result.solana as
    | { encoding?: unknown; data?: unknown }
    | undefined;
  if (
    !feed ||
    parsed?.priceFeeds?.length !== 1 ||
    String(feed.priceFeedId) !== input.feedId.toString() ||
    signed?.encoding !== 'base64' ||
    typeof signed.data !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signed.data)
  )
    throw new Error('signed reference unavailable');
  const bytes = Uint8Array.from(Buffer.from(signed.data, 'base64'));
  if (
    bytes.length < 102 ||
    bytes.length > 1024 ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      0,
      true,
    ) !== 2_182_742_457 ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
      100,
      true,
    ) !==
      bytes.length - 102
  )
    throw new Error('signed reference unavailable');
  const price = BigInt(String(feed.price));
  const confidence = BigInt(String(feed.confidence));
  const exponent = Number(feed.exponent);
  const publisherCount = Number(feed.publisherCount);
  const sessionMask = SESSION_MASK[String(feed.marketSession)] ?? 0;
  const feedUpdateTimestampUs = BigInt(String(feed.feedUpdateTimestamp));
  const nowUs = input.chainTime * 1_000_000n;
  if (
    price <= 0n ||
    confidence < 0n ||
    !Number.isInteger(exponent) ||
    exponent < -18 ||
    exponent > 18 ||
    !Number.isInteger(publisherCount) ||
    publisherCount < input.minimumPublisherCount ||
    sessionMask === 0 ||
    (sessionMask & input.allowedSessionMask) === 0 ||
    confidence * 10_000n > price * BigInt(input.maximumConfidenceRatioBps) ||
    feedUpdateTimestampUs > nowUs + 30_000_000n ||
    nowUs - feedUpdateTimestampUs > BigInt(input.maximumAgeSeconds) * 1_000_000n
  )
    throw new Error('signed reference is outside settlement policy');
  return {
    bytes,
    price,
    exponent,
    confidence,
    publisherCount,
    sessionMask,
    feedUpdateTimestampUs,
  };
}
