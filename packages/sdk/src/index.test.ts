import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  createDevnetStockClaimInstruction,
  deriveDevnetStockClaimAddresses,
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
  });
});
