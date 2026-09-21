import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../lib/environment';

const environment = {
  SOLANA_NETWORK: 'devnet',
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  PYTH_API_KEY: 'key',
  BAZO_MARKET_ID: 'acme',
  BAZO_MARKET_SYMBOL: 'ACME',
  BAZO_MARKET_NAME: 'Acme Holdings',
  BAZO_STOCK_MINT: '11111111111111111111111111111111',
  BAZO_STOCK_TOKEN_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  BAZO_QUOTE_MINT: '11111111111111111111111111111111',
  BAZO_QUOTE_TOKEN_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  BAZO_QUOTE_SYMBOL: 'USDC',
  BAZO_TOKEN_DECIMALS: '6',
  BAZO_SUPPORTED_EXTENSIONS: 'ScaledUiAmountConfig',
  BAZO_PYTH_FEED_ID: '7',
  BAZO_ALLOWED_SESSIONS: 'regular',
  BAZO_MAX_REFERENCE_AGE_SECONDS: '90',
  BAZO_MIN_PUBLISHER_COUNT: '3',
  BAZO_MAX_CONFIDENCE_RATIO_BPS: '100',
  BAZO_MINIMUM_STAGE_RAW_AMOUNT: '1',
  BAZO_BATCH_DURATION_SECONDS: '300',
};

describe('server environment', () => {
  it('parses the Devnet Market configuration without exposing a public key', () => {
    expect(parseEnvironment(environment).SOLANA_NETWORK).toBe('devnet');
  });

  it('identifies the missing configuration variable', () => {
    const { PYTH_API_KEY: _key, ...withoutPythKey } = environment;
    expect(() => parseEnvironment(withoutPythKey)).toThrow('PYTH_API_KEY');
  });

  it('accepts only a numeric Pyth Pro feed identifier', () => {
    expect(() =>
      parseEnvironment({ ...environment, BAZO_PYTH_FEED_ID: 'not-a-feed-id' }),
    ).toThrow('BAZO_PYTH_FEED_ID');
  });
});
