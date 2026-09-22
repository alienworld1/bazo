import { AccountRole, address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  createDevnetStockClaimInstruction,
  deriveDevnetStockClaimAddresses,
  encodeBuyRequestOpening,
  hashBuyRequestOpening,
} from './index';

const programAddress = address('6e35GBMnuKLhWCJe3qmzWuJbN9L6XCTMPvAx5hgXLagb');
const market = address('H83inusRWiShJZsVT3rTFXafo1wSCgb5HKTJEsM2LRgu');
const recipient = address('4Z1WAbsiJTtopLfGvei6CA5ejy5fVxZgtSmmXrTRSPhe');
const stockMint = address('3bEb8QPW7edXzvcm1udGcRjr6NfpbvyXrwAdK5upXUTQ');
const stockTokenProgram = address(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);
const recipientStockAccount = address('6qxP3oSzZRfAC3eekfVF8ptXh392nsSsPfLZQszMnDRJ');

describe('Devnet stock claim instruction', () => {
  it('derives a market-bound faucet and one-claim receipt', async () => {
    await expect(
      deriveDevnetStockClaimAddresses({
        programAddress,
        market,
        recipient,
      }),
    ).resolves.toEqual({
      faucetAuthority: address('3FfX6qrcLwbfprV4fHCUD7KggVW3cNUaJYtdCWqh7LPr'),
      claim: address('87yxCDZjen1EwrCaMYHDKiVrNLDgBWMQLwaLzbhNiRtF'),
    });
  });

  it('uses the program’s fixed account order without caller-controlled amounts', async () => {
    const instruction = await createDevnetStockClaimInstruction({
      programAddress,
      recipient,
      market,
      stockMint,
      stockTokenProgram,
      recipientStockAccount,
    });

    expect(instruction.programAddress).toBe(programAddress);
    expect(instruction.accounts.map(account => account.address)).toEqual([
      recipient,
      market,
      stockMint,
      stockTokenProgram,
      recipientStockAccount,
      address('3FfX6qrcLwbfprV4fHCUD7KggVW3cNUaJYtdCWqh7LPr'),
      address('87yxCDZjen1EwrCaMYHDKiVrNLDgBWMQLwaLzbhNiRtF'),
      address('11111111111111111111111111111111'),
    ]);
    expect(instruction.data).toEqual(
      new Uint8Array([106, 29, 227, 149, 108, 175, 167, 50]),
    );
    expect(instruction.accounts[2]?.role).toBe(AccountRole.WRITABLE);
  });
});

describe('Buy Request commitment', () => {
  const opening = {
    schemaVersion: 1 as const,
    network: 1 as const,
    request: address('11111111111111111111111111111111'),
    buyer: address('SysvarC1ock11111111111111111111111111111111'),
    recipient: address('SysvarRent111111111111111111111111111111111'),
    market: address('Stake11111111111111111111111111111111111111'),
    targetRawQuantity: 2_500_001n,
    maxPremiumBps: 100,
    maxQuoteAmount: 7_500_000n,
    expiresAt: 1_800_000_000n,
    allowPartialFills: true,
    requestNonce: 42n,
    salt: new Uint8Array(32).fill(7),
  };

  it('matches the Rust golden hash without encoding display values', async () => {
    expect(encodeBuyRequestOpening(opening)).toHaveLength(219);
    expect(toHex(await hashBuyRequestOpening(opening))).toBe(
      'deb9b59583c806ea7c9674ba7dc02e9cbac549dbb92d3b238f2ce10e27c2c1c2',
    );
  });

  it('rejects an invalid private opening and changes the hash when a bound field changes', async () => {
    expect(() => encodeBuyRequestOpening({ ...opening, maxPremiumBps: -10_000 })).toThrow();
    expect(toHex(await hashBuyRequestOpening({ ...opening, allowPartialFills: false }))).not.toBe(
      toHex(await hashBuyRequestOpening(opening)),
    );
  });
});

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
