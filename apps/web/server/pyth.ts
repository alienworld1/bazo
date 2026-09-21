import 'server-only';
import { z } from 'zod';
import type { MarketConfig, NormalizedReference } from '@/lib/markets';
import { evaluateReference } from '@/lib/reference-policy';
import { getEnvironment } from './env';

const upstreamSchema = z.object({
  parsed: z.object({
    priceFeeds: z.array(
      z.object({
        feedId: z.union([z.string(), z.number()]),
        price: z.object({
          price: z.union([z.string(), z.number()]),
          exponent: z.number(),
          confidence: z.union([z.string(), z.number()]),
          publishTime: z.union([z.string(), z.number()]),
        }),
        publisherCount: z.number().optional(),
        marketSession: z
          .enum(['regular', 'preMarket', 'postMarket', 'overNight', 'closed'])
          .optional(),
      }),
    ),
  }),
});

export async function readReference(
  market: MarketConfig,
): Promise<NormalizedReference> {
  const env = getEnvironment();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      'https://pyth-lazer.dourolabs.app/v1/latest_price',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.PYTH_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceFeedIds: [market.pythFeedId],
          properties: ['price'],
          formats: ['solana'],
          channel: 'fixed_rate@1000ms',
        }),
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error('Pyth reference unavailable');
    const payload = upstreamSchema.parse(await response.json());
    const feed = payload.parsed.priceFeeds[0];
    if (!feed) throw new Error('Pyth reference unavailable');
    return evaluateReference(
      {
        marketId: market.id,
        feedId: String(feed.feedId),
        price: String(feed.price.price),
        exponent: feed.price.exponent,
        formattedPrice: formatPrice(
          String(feed.price.price),
          feed.price.exponent,
        ),
        confidence: String(feed.price.confidence),
        publisherCount: feed.publisherCount ?? 0,
        marketSession: feed.marketSession ?? 'unknown',
        feedUpdateTimestamp: String(feed.price.publishTime),
      },
      market,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function formatPrice(price: string, exponent: number): string {
  const value = BigInt(price);
  if (exponent >= 0) return `${value}${'0'.repeat(exponent)}`;
  const digits = value.toString();
  const position = digits.length + exponent;
  return position > 0
    ? `${digits.slice(0, position)}.${digits.slice(position)}`
    : `0.${'0'.repeat(-position)}${digits}`;
}
