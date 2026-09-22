import type { PublicBuyRequest } from '@/lib/buy-request-projection';

type FundedRequest = PublicBuyRequest & { escrowRawAmount: string };

export async function reconcileFundedBuyRequest(input: {
  requestAddress: string;
  buyer: string;
  recipient: string;
  market: string;
  escrow: string;
  quoteRawAmount: bigint;
  expiresAt: bigint;
  commitment: Uint8Array;
}): Promise<boolean> {
  const response = await fetch(`/api/buy-requests/${input.requestAddress}`, {
    cache: 'no-store',
  });
  if (!response.ok) return false;
  const request = (await response.json()) as FundedRequest;
  const commitmentHex = Array.from(input.commitment, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return (
    request.address === input.requestAddress &&
    request.buyer === input.buyer &&
    request.recipient === input.recipient &&
    request.market === input.market &&
    request.escrow === input.escrow &&
    request.commitmentHex === commitmentHex &&
    request.maxQuoteAmount === input.quoteRawAmount.toString() &&
    request.escrowRawAmount === input.quoteRawAmount.toString() &&
    request.expiresAt === input.expiresAt.toString() &&
    request.spentQuoteAmount === '0' &&
    request.filledRawQuantity === '0' &&
    request.lockedBatch === null &&
    request.status === 'active'
  );
}
