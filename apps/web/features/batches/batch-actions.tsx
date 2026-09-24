'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { expireBatchInstruction, type PublicBatch } from '@bazo/sdk';
import { solanaClient } from '@/components/solana-client';
import { simulateWalletTransaction } from '@/components/simulate-wallet-transaction';

export function BatchActions({
  batch,
  chainTime,
  programAddress,
}: {
  batch: PublicBatch;
  chainTime: string;
  programAddress: string;
}) {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  if (
    batch.status === 'expired' ||
    batch.status === 'settled' ||
    BigInt(chainTime) < BigInt(batch.lockDeadline)
  )
    return null;

  const expire = async () => {
    if (!connected) return;
    setError(undefined);
    setProgress('Checking Batch expiry…');
    try {
      const instruction = await expireBatchInstruction({
        programAddress: address(programAddress),
        caller: address(connected.account.address),
        batch,
      });
      await simulateWalletTransaction([instruction]);
      setProgress('Awaiting approval…');
      await solanaClient.sendTransaction([instruction]);
      setProgress('Checking confirmation…');
      const response = await fetch(`/api/batches/${batch.address}`, {
        cache: 'no-store',
      });
      const updated = response.ok
        ? ((await response.json()) as PublicBatch)
        : null;
      if (updated?.status !== 'expired') throw new Error('unconfirmed');
      router.refresh();
    } catch {
      setError("We couldn't verify Batch expiry. Refresh before trying again.");
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <section className="mt-8 border-t border-line-default pt-5">
      <p className="text-sm text-text-secondary">
        The lock deadline has passed. Anyone can release this Batch so requests
        can be used again.
      </p>
      {connected ? (
        <button
          type="button"
          disabled={Boolean(progress)}
          onClick={() => void expire()}
          className="mt-4 min-h-11 border border-line-strong bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          Release Batch
        </button>
      ) : (
        <p className="mt-3 text-sm text-text-secondary">
          Connect wallet to release this Batch.
        </p>
      )}
      {progress ? (
        <p className="mt-3 text-sm text-text-secondary" aria-live="polite">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
