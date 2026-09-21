import { z } from 'zod';

const environmentSchema = z.object({
  SOLANA_NETWORK: z.literal('devnet'),
  SOLANA_RPC_URL: z.url(),
  PYTH_API_KEY: z.string().min(1),
  BAZO_PROGRAM_ID: z.string().min(32),
  BAZO_MARKET_ID: z.string().regex(/^[a-z0-9-]+$/),
  BAZO_MARKET_SYMBOL: z.string().min(1),
  BAZO_MARKET_NAME: z.string().min(1),
  BAZO_STOCK_MINT: z.string().min(32),
  BAZO_STOCK_TOKEN_PROGRAM: z.string().min(32),
  BAZO_QUOTE_MINT: z.string().min(32),
  BAZO_QUOTE_TOKEN_PROGRAM: z.string().min(32),
  BAZO_QUOTE_SYMBOL: z.string().min(1),
  BAZO_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(255),
  BAZO_SUPPORTED_EXTENSIONS: z.string(),
  BAZO_PYTH_FEED_ID: z.string().regex(/^[1-9]\d*$/),
  BAZO_ALLOWED_SESSIONS: z.string().min(1),
  BAZO_MAX_REFERENCE_AGE_SECONDS: z.coerce.number().int().positive(),
  BAZO_MIN_PUBLISHER_COUNT: z.coerce.number().int().positive(),
  BAZO_MAX_CONFIDENCE_RATIO_BPS: z.coerce.number().int().positive(),
  BAZO_MINIMUM_STAGE_RAW_AMOUNT: z.string().regex(/^\d+$/),
  BAZO_BATCH_DURATION_SECONDS: z.coerce.number().int().positive(),
});

export function parseEnvironment(input: unknown) {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid Bazo server configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`,
    );
  }
  return parsed.data;
}
