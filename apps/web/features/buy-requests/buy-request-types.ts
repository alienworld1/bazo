import type { BuyRequestOpeningV1 } from '@bazo/sdk';

export type PreparedBuyRequest = {
  request: string;
  escrow: string;
  nonce: bigint;
  commitment: Uint8Array;
  opening: BuyRequestOpeningV1;
  quantityRaw: bigint;
  premiumBps: number;
  quoteRaw: bigint;
  expiresAt: bigint;
  quoteDecimals: number;
  multiplier: string;
  sourceTokenAccount: string;
  balanceAfter: bigint;
  referenceLabel: string;
};
