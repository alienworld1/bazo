import 'server-only';
import type { MarketConfig, MarketSession } from '@/lib/markets';
import { getEnvironment } from './env';

const sessions = new Set<MarketSession>([
  'regular',
  'preMarket',
  'postMarket',
  'overNight',
]);

export function getEnabledMarkets(): MarketConfig[] {
  const env = getEnvironment();
  const allowedSessions = env.BAZO_ALLOWED_SESSIONS.split(
    ',',
  ) as MarketSession[];
  if (allowedSessions.some(session => !sessions.has(session))) {
    throw new Error('Invalid Bazo server configuration: BAZO_ALLOWED_SESSIONS');
  }
  return [
    {
      id: env.BAZO_MARKET_ID,
      symbol: env.BAZO_MARKET_SYMBOL,
      displayName: env.BAZO_MARKET_NAME,
      network: env.SOLANA_NETWORK,
      stockMint: env.BAZO_STOCK_MINT,
      stockTokenProgram: env.BAZO_STOCK_TOKEN_PROGRAM,
      quoteMint: env.BAZO_QUOTE_MINT,
      quoteTokenProgram: env.BAZO_QUOTE_TOKEN_PROGRAM,
      quoteSymbol: env.BAZO_QUOTE_SYMBOL,
      tokenDecimals: env.BAZO_TOKEN_DECIMALS,
      supportedStockExtensions:
        env.BAZO_SUPPORTED_EXTENSIONS.split(',').filter(Boolean),
      pythFeedId: env.BAZO_PYTH_FEED_ID,
      allowedSessions,
      maxReferenceAgeSeconds: env.BAZO_MAX_REFERENCE_AGE_SECONDS,
      minPublisherCount: env.BAZO_MIN_PUBLISHER_COUNT,
      maxConfidenceRatioBps: env.BAZO_MAX_CONFIDENCE_RATIO_BPS,
      minimumStageRawAmount: env.BAZO_MINIMUM_STAGE_RAW_AMOUNT,
      batchDurationSeconds: env.BAZO_BATCH_DURATION_SECONDS,
      enabled: true,
    },
  ];
}

export function getMarket(marketId: string): MarketConfig | undefined {
  return getEnabledMarkets().find(
    market => market.id === marketId && market.enabled,
  );
}
