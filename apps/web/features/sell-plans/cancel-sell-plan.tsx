'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { cancelPlanInstruction } from '@bazo/sdk';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { simulateWalletTransaction } from '@/components/simulate-wallet-transaction';
import { solanaClient } from '@/components/solana-client';

type Props = {
  programAddress: string;
  plan: string;
  owner: string;
  market: string;
  currentStageIndex: number;
  currentCommitment: string;
  remainingRawInventory: string;
};

export function CancelSellPlan(props: Props) {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [review, setReview] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const isOwner = connected?.account.address === props.owner;

  if (!isOwner)
    return (
      <p className="mt-4 text-sm text-text-secondary">
        Connect the wallet that owns this Plan to cancel it.
      </p>
    );

  const cancel = async () => {
    if (
      progress ||
      submitted ||
      !connected ||
      connected.account.address !== props.owner
    )
      return;
    setError(undefined);
    setProgress('Preparing transaction…');
    let sent = false;
    try {
      const response = await fetch(`/api/sell-plans/${props.plan}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('status unavailable');
      const latest = (await response.json()) as {
        status: string;
        owner: string;
        currentStageIndex: number;
        currentCommitment: string;
        remainingRawInventory: string;
        reservation: unknown;
      };
      if (
        latest.status !== 'active' ||
        latest.owner !== props.owner ||
        latest.currentStageIndex !== props.currentStageIndex ||
        latest.currentCommitment !== props.currentCommitment ||
        latest.remainingRawInventory !== props.remainingRawInventory ||
        latest.reservation
      )
        throw new Error('status changed');
      const instruction = await cancelPlanInstruction({
        programAddress: address(props.programAddress),
        owner: address(props.owner),
        market: address(props.market),
        plan: address(props.plan),
        currentStageIndex: props.currentStageIndex,
      });
      await simulateWalletTransaction([instruction]);
      setProgress('Awaiting approval…');
      await solanaClient.sendTransaction([instruction]);
      sent = true;
      setSubmitted(true);
      setProgress('Verifying updated Plan…');
      const verified = await fetch(`/api/sell-plans/${props.plan}`, {
        cache: 'no-store',
      });
      if (
        !verified.ok ||
        ((await verified.json()) as { status: string }).status !== 'canceled'
      )
        throw new Error('confirmation uncertain');
      setReview(false);
      setProgress(undefined);
      router.refresh();
    } catch {
      setProgress(undefined);
      setError(
        sent
          ? "We're checking whether your transaction completed. Refresh this Plan before trying again."
          : "We couldn't confirm the latest status. Refresh this Plan before trying again.",
      );
    }
  };

  return (
    <section
      className="mt-8 border-t border-line-default pt-5"
      aria-live="polite"
    >
      <h2 className="text-lg font-medium text-text-primary">
        End the remaining Plan
      </h2>
      {review ? (
        <div className="mt-3 text-sm text-text-secondary">
          <p>
            Completed sales stay final. Unused stock can be returned after this
            Plan ends.
          </p>
          <p className="mt-2">
            Remaining stock:{' '}
            <span className="font-mono">{props.remainingRawInventory}</span> raw
            units. Cancellation does not transfer stock or proceeds.
          </p>
          <p className="mt-2">Devnet · fee payer: your connected wallet.</p>
          <p className="mt-1 break-all font-mono text-xs">Plan: {props.plan}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={Boolean(progress) || submitted}
              onClick={() => void cancel()}
              className="min-h-11 border border-line-strong bg-surface-3 px-4 text-text-primary disabled:text-text-disabled"
            >
              Confirm cancellation
            </button>
            <button
              type="button"
              disabled={Boolean(progress)}
              onClick={() => setReview(false)}
              className="min-h-11 border border-line-default px-4 text-text-primary"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={submitted}
          onClick={() => setReview(true)}
          className="mt-3 min-h-11 border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          Cancel Sell Plan
        </button>
      )}
      {progress ? (
        <p className="mt-3 text-sm text-text-secondary">{progress}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      {submitted ? (
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 min-h-11 text-sm text-text-primary underline"
        >
          Refresh status
        </button>
      ) : null}
    </section>
  );
}
