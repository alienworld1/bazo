import type { Address } from '@solana/kit';
import { compareAddressBytes } from './batch';

const U64_MAX = 0xffff_ffff_ffff_ffffn;

export type MatchBuyer = {
  request: Address;
  createdSlot: bigint;
  remainingRawQuantity: bigint;
  maxPremiumBps: number;
  allowPartialFills: boolean;
  remainingQuoteCap: bigint;
};
export type MatchSeller = {
  plan: Address;
  createdAt: bigint;
  stageFingerprint: string;
  rawQuantity: bigint;
  minPremiumBps: number;
};
export type MatchProposal = {
  version: 1;
  batch: Address;
  plan: Address;
  stageFingerprint: string;
  buyerOrder: Address[];
  sellerOrder: Address[];
  allocations: { request: Address; rawQuantity: string }[];
  marginalPremiumBps: number;
  lockDeadline: string;
  affordability: 'pending_verified_reference';
  fingerprint: string;
};

export async function buildMatchProposal(input: {
  batch: Address;
  lockDeadline: bigint;
  chainTime: bigint;
  buyers: readonly MatchBuyer[];
  sellers: readonly MatchSeller[];
}): Promise<MatchProposal | null> {
  if (
    input.chainTime >= input.lockDeadline ||
    input.buyers.length === 0 ||
    input.sellers.length === 0
  )
    return null;
  if (
    new Set(input.buyers.map(buyer => buyer.request)).size !==
    input.buyers.length
  )
    return null;
  const buyers = [...input.buyers].sort(
    (a, b) =>
      b.maxPremiumBps - a.maxPremiumBps ||
      compareBigInt(a.createdSlot, b.createdSlot) ||
      compareAddressBytes(a.request, b.request),
  );
  const sellers = [...input.sellers].sort(
    (a, b) =>
      a.minPremiumBps - b.minPremiumBps ||
      compareBigInt(a.createdAt, b.createdAt) ||
      compareAddressBytes(a.plan, b.plan),
  );
  for (const seller of sellers) {
    if (seller.rawQuantity <= 0n || seller.rawQuantity > U64_MAX) continue;
    let remainder = seller.rawQuantity;
    const allocations: { request: Address; rawQuantity: string }[] = [];
    let marginalPremiumBps = seller.minPremiumBps;
    for (const buyer of buyers) {
      if (
        buyer.maxPremiumBps < seller.minPremiumBps ||
        buyer.remainingQuoteCap <= 0n ||
        buyer.remainingRawQuantity <= 0n ||
        buyer.remainingRawQuantity > U64_MAX
      )
        continue;
      if (!buyer.allowPartialFills && buyer.remainingRawQuantity > remainder)
        continue;
      const amount =
        buyer.remainingRawQuantity < remainder
          ? buyer.remainingRawQuantity
          : remainder;
      allocations.push({
        request: buyer.request,
        rawQuantity: amount.toString(),
      });
      marginalPremiumBps = buyer.maxPremiumBps;
      remainder -= amount;
      if (remainder === 0n) break;
    }
    if (remainder !== 0n) continue;
    const payload = {
      version: 1 as const,
      batch: input.batch,
      plan: seller.plan,
      stageFingerprint: seller.stageFingerprint,
      buyerOrder: buyers.map(buyer => buyer.request),
      sellerOrder: sellers.map(item => item.plan),
      allocations,
      marginalPremiumBps,
      lockDeadline: input.lockDeadline.toString(),
      affordability: 'pending_verified_reference' as const,
    };
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(payload)),
      ),
    );
    return {
      ...payload,
      fingerprint: Array.from(digest, byte =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    };
  }
  return null;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
