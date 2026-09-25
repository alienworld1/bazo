'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { releasePlanReservationInstruction } from '@bazo/sdk';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { simulateWalletTransaction } from '@/components/simulate-wallet-transaction';
import { solanaClient } from '@/components/solana-client';
import { useHasHydrated } from '@/components/use-has-hydrated';

export function ReleaseStageReservation({
  programAddress,
  plan,
  stageIndex,
}: {
  programAddress: string;
  plan: string;
  stageIndex: number;
}) {
  const hasHydrated = useHasHydrated();
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  const release = async () => {
    if (!connected || progress || sent) return;
    setError(undefined);
    setProgress('Preparing transaction…');
    let submitted = false;
    try {
      const instruction = await releasePlanReservationInstruction({
        programAddress: address(programAddress),
        caller: address(connected.account.address),
        plan: address(plan),
        stageIndex,
      });
      await simulateWalletTransaction([instruction]);
      setProgress('Awaiting approval…');
      await solanaClient.sendTransaction([instruction]);
      submitted = true;
      setSent(true);
      setProgress('Verifying updated Plan…');
      const response = await fetch(`/api/sell-plans/${plan}`, {
        cache: 'no-store',
      });
      if (
        !response.ok ||
        ((await response.json()) as { reservation: unknown }).reservation
      )
        throw new Error('unconfirmed');
      setProgress(undefined);
      router.refresh();
    } catch {
      setProgress(undefined);
      setError(
        submitted
          ? "We're checking whether your transaction completed. Refresh status before trying again."
          : "We couldn't release the reservation. Refresh status and try again.",
      );
    }
  };

  return (
    <div className="mt-4" aria-live="polite">
      {hasHydrated && connected ? (
        <button
          type="button"
          disabled={Boolean(progress) || sent}
          onClick={() => void release()}
          className="min-h-11 border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          Release Stage reservation
        </button>
      ) : (
        <p className="text-sm text-text-secondary">
          Connect a wallet to release this expired reservation.
        </p>
      )}
      {progress ? (
        <p className="mt-2 text-sm text-text-secondary">{progress}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 min-h-11 text-sm text-text-primary underline"
        >
          Refresh status
        </button>
      ) : null}
    </div>
  );
}
