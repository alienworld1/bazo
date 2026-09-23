import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  buildMatchProposal,
  type MatchBuyer,
  type MatchSeller,
} from './matching';
import fixture from '../fixtures/batch-allocation.json';

const keys = [
  address('11111111111111111111111111111111'),
  address('SysvarC1ock11111111111111111111111111111111'),
  address('SysvarRent111111111111111111111111111111111'),
  address('Stake11111111111111111111111111111111111111'),
  address('Vote111111111111111111111111111111111111111'),
];
const seller: MatchSeller = {
  plan: keys[4],
  createdAt: 10n,
  stageFingerprint: 'a'.repeat(64),
  rawQuantity: 10n,
  minPremiumBps: 50,
};
const buyers: MatchBuyer[] = [
  {
    request: keys[1],
    createdSlot: 1n,
    remainingRawQuantity: 3n,
    maxPremiumBps: 150,
    allowPartialFills: true,
    remainingQuoteCap: 100n,
  },
  {
    request: keys[2],
    createdSlot: 2n,
    remainingRawQuantity: 4n,
    maxPremiumBps: 100,
    allowPartialFills: true,
    remainingQuoteCap: 100n,
  },
  {
    request: keys[3],
    createdSlot: 3n,
    remainingRawQuantity: 5n,
    maxPremiumBps: 80,
    allowPartialFills: true,
    remainingQuoteCap: 100n,
  },
];

describe('deterministic matching', () => {
  const input = {
    batch: keys[0],
    lockDeadline: 100n,
    chainTime: 20n,
    sellers: [seller],
  };

  it('fully covers the Stage with one uniform marginal premium and stable bytes', async () => {
    const first = await buildMatchProposal({ ...input, buyers });
    const second = await buildMatchProposal({
      ...input,
      buyers: [...buyers].reverse(),
    });
    expect(second).toEqual(first);
    expect(first?.allocations.map(item => item.rawQuantity)).toEqual([
      '3',
      '4',
      '3',
    ]);
    expect(first?.marginalPremiumBps).toBe(80);
    expect(first?.affordability).toBe('pending_verified_reference');
  });

  it('matches the shared Rust allocation fixture', async () => {
    const fromFixture = fixture.buyers.map(buyer => ({
      ...buyer,
      request: address(buyer.request),
      createdSlot: BigInt(buyer.createdSlot),
      remainingRawQuantity: BigInt(buyer.remainingRawQuantity),
      remainingQuoteCap: BigInt(buyer.remainingQuoteCap),
    }));
    const plan = {
      ...fixture.seller,
      plan: address(fixture.seller.plan),
      createdAt: BigInt(fixture.seller.createdAt),
      rawQuantity: BigInt(fixture.seller.rawQuantity),
    };
    const proposal = await buildMatchProposal({
      ...input,
      sellers: [plan],
      buyers: fromFixture,
    });
    expect(proposal?.allocations.map(value => value.rawQuantity)).toEqual(
      fixture.expectedAllocations,
    );
    expect(proposal?.marginalPremiumBps).toBe(
      fixture.expectedMarginalPremiumBps,
    );
  });

  it('does not partially allocate a non-partial buyer', async () => {
    const proposal = await buildMatchProposal({
      ...input,
      buyers: [
        ...buyers.slice(0, 2),
        { ...buyers[2], allowPartialFills: false },
      ],
    });
    expect(proposal).toBeNull();
  });

  it('rejects one raw unit short, duplicate demand, and elapsed lock', async () => {
    expect(
      await buildMatchProposal({
        ...input,
        buyers: buyers.map((buyer, index) =>
          index === 2 ? { ...buyer, remainingRawQuantity: 2n } : buyer,
        ),
      }),
    ).toBeNull();
    expect(
      await buildMatchProposal({ ...input, buyers: [...buyers, buyers[0]] }),
    ).toBeNull();
    expect(
      await buildMatchProposal({ ...input, buyers, chainTime: 100n }),
    ).toBeNull();
  });
});
