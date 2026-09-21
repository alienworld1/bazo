export type MarketSession =
  | 'regular'
  | 'preMarket'
  | 'postMarket'
  | 'overNight';

export type ReferenceStatus =
  | 'valid'
  | 'stale'
  | 'closed'
  | 'session_not_allowed'
  | 'insufficient_publishers'
  | 'confidence_too_wide'
  | 'feed_mismatch'
  | 'unavailable'
  | 'invalid';

export type MarketConfig = {
  id: string;
  symbol: string;
  displayName: string;
  network: 'devnet';
  stockMint: string;
  stockTokenProgram: string;
  quoteMint: string;
  quoteTokenProgram: string;
  quoteSymbol: string;
  tokenDecimals: number;
  supportedStockExtensions: readonly string[];
  pythFeedId: string;
  allowedSessions: readonly MarketSession[];
  maxReferenceAgeSeconds: number;
  minPublisherCount: number;
  maxConfidenceRatioBps: number;
  minimumStageRawAmount: string;
  batchDurationSeconds: number;
  enabled: boolean;
};

export type NormalizedReference = {
  marketId: string;
  feedId: string;
  price: string;
  exponent: number;
  formattedPrice: string;
  confidence: string;
  publisherCount: number;
  marketSession: MarketSession | 'closed' | 'unknown';
  feedUpdateTimestamp: string;
  receivedAt: string;
  ageSeconds: number;
  status: ReferenceStatus;
  reasons: string[];
};

export type PublicMarket = Omit<
  MarketConfig,
  'minimumStageRawAmount' | 'batchDurationSeconds'
>;

export function toPublicMarket(market: MarketConfig): PublicMarket {
  return {
    id: market.id,
    symbol: market.symbol,
    displayName: market.displayName,
    network: market.network,
    stockMint: market.stockMint,
    stockTokenProgram: market.stockTokenProgram,
    quoteMint: market.quoteMint,
    quoteTokenProgram: market.quoteTokenProgram,
    quoteSymbol: market.quoteSymbol,
    tokenDecimals: market.tokenDecimals,
    supportedStockExtensions: market.supportedStockExtensions,
    pythFeedId: market.pythFeedId,
    allowedSessions: market.allowedSessions,
    maxReferenceAgeSeconds: market.maxReferenceAgeSeconds,
    minPublisherCount: market.minPublisherCount,
    maxConfidenceRatioBps: market.maxConfidenceRatioBps,
    enabled: market.enabled,
  };
}
