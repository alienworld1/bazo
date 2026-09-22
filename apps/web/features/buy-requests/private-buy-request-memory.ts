import { hashBuyRequestOpening, type BuyRequestOpeningV1 } from '@bazo/sdk';

const openings = new Map<string, BuyRequestOpeningV1>();

export function rememberBuyRequestOpening(opening: BuyRequestOpeningV1): void {
  openings.set(opening.request, opening);
}

export async function getVerifiedBuyRequestOpening(
  requestAddress: string,
  buyer: string,
  commitmentHex: string,
): Promise<BuyRequestOpeningV1 | null> {
  const opening = openings.get(requestAddress);
  if (!opening || opening.buyer !== buyer) return null;
  const digest = await hashBuyRequestOpening(opening);
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(
    '',
  ) === commitmentHex
    ? opening
    : null;
}

export function forgetBuyRequestOpening(requestAddress: string): void {
  openings.delete(requestAddress);
}
