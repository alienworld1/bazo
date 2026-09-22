'use client';

import { useState } from 'react';
import { address } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token-2022';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import {
  createDevnetStockClaimInstruction,
  deriveMarketAddress,
} from '@bazo/sdk';
import { solanaClient } from '@/components/solana-client';

export function DevnetStockClaim({
  marketSymbol,
  stockMint,
  quoteMint,
  stockTokenProgram,
  programAddress,
  onClaimed,
}: {
  marketSymbol: string;
  stockMint: string;
  quoteMint: string;
  stockTokenProgram: string;
  programAddress: string;
  onClaimed: () => Promise<void>;
}) {
  const connected = useConnectedWallet(solanaClient);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  if (!connected) return null;

  const claim = async () => {
    setStatus('Preparing your Devnet stock claim…');
    setError(undefined);
    try {
      const recipient = address(connected.account.address);
      const mint = address(stockMint);
      const tokenProgram = address(stockTokenProgram);
      const onchainMarket = await deriveMarketAddress(address(programAddress), {
        stockMint: mint,
        quoteMint: address(quoteMint),
      });
      const [recipientStockAccount] = await findAssociatedTokenPda({
        owner: recipient,
        mint,
        tokenProgram,
      });
      const createAccount = getCreateAssociatedTokenIdempotentInstruction({
        payer: solanaClient.payer,
        ata: recipientStockAccount,
        owner: recipient,
        mint,
        tokenProgram,
      });
      const claimInstruction = await createDevnetStockClaimInstruction({
        programAddress: address(programAddress),
        recipient,
        market: onchainMarket,
        stockMint: mint,
        stockTokenProgram: tokenProgram,
        recipientStockAccount,
      });
      setStatus('Approve the Devnet stock claim in your wallet…');
      await solanaClient.sendTransaction([createAccount, claimInstruction]);
      setStatus('Refreshing your supported position…');
      await onClaimed();
    } catch (claimError) {
      setStatus(undefined);
      const message =
        claimError instanceof Error ? claimError.message.toLowerCase() : '';
      setError(
        message.includes('already')
          ? 'This wallet has already claimed its Devnet stock.'
          : 'We couldn’t complete the Devnet stock claim. Nothing moved from your wallet.',
      );
    }
  };

  return (
    <section className="mt-6 border-y border-line-default py-6" aria-live="polite">
      <h2 className="text-lg font-medium text-text-primary">
        Get stock for Devnet
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Claim 10 {marketSymbol} stock once to explore Sell Plans. This is a Devnet
        test asset and is not issuer-backed.
      </p>
      <button
        type="button"
        onClick={() => void claim()}
        disabled={Boolean(status)}
        className="mt-4 min-h-11 rounded border border-line-strong bg-surface-3 px-4 text-sm text-text-primary hover:border-focus disabled:text-text-disabled"
      >
        {status ?? 'Claim stock for Devnet'}
      </button>
      {error ? <p className="mt-3 text-sm text-warning">{error}</p> : null}
    </section>
  );
}
