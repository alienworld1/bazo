'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { claimPlanProceedsInstruction } from '@bazo/sdk';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { solanaClient } from '@/components/solana-client';
import { simulateWalletTransaction } from '@/components/simulate-wallet-transaction';
import { formatDisplayAmount } from '@/lib/token-amounts';
import { ownerTokenDestination } from '@/components/owner-token-destination';
import { useHasHydrated } from '@/components/use-has-hydrated';

type Props = {
  plan: string;
  owner: string;
  market: string;
  marketId: string;
  proceedsVault: string;
  programAddress: string;
  quoteMint: string;
  quoteTokenProgram: string;
  quoteSymbol: string;
  quoteDecimals: number;
  claimableRawAmount: string;
  claimedRawAmount: string;
};

export function ClaimPlanProceeds(props: Props) {
  const hasHydrated = useHasHydrated();
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const reviewContext = `${connected?.account.address ?? ''}:${props.claimableRawAmount}:${props.claimedRawAmount}`;
  const [previousReviewContext, setPreviousReviewContext] =
    useState(reviewContext);
  if (previousReviewContext !== reviewContext) {
    setPreviousReviewContext(reviewContext);
    setDestination(undefined);
  }
  if (BigInt(props.claimableRawAmount) === 0n) return null;
  if (!hasHydrated || !connected || connected.account.address !== props.owner)
    return (
      <p className="mt-3 text-sm text-text-secondary">
        Connect the wallet that owns this Plan to claim proceeds.
      </p>
    );

  const prepare = async () => {
    setError(undefined);
    try {
      const destination = await ownerTokenDestination({
        owner: props.owner,
        mint: props.quoteMint,
        tokenProgram: props.quoteTokenProgram,
      });
      setDestination(destination.address);
    } catch {
      setError(
        "We couldn't prepare your quote account. Please refresh and try again.",
      );
    }
  };

  const submit = async () => {
    if (
      !destination ||
      progress ||
      submitted ||
      connected?.account.address !== props.owner
    )
      return;
    setError(undefined);
    setProgress('Preparing transaction…');
    let sent = false;
    try {
      const latestResponse = await fetch(`/api/sell-plans/${props.plan}`, {
        cache: 'no-store',
      });
      if (!latestResponse.ok) throw new Error('status unavailable');
      const latest = (await latestResponse.json()) as {
        owner: string;
        market: string;
        proceedsVault: string;
        accruedQuoteAmount: string;
        claimedQuoteAmount: string;
        proceedsVaultRawAmount: string;
      };
      if (
        latest.owner !== props.owner ||
        latest.market !== props.market ||
        latest.proceedsVault !== props.proceedsVault ||
        latest.claimedQuoteAmount !== props.claimedRawAmount ||
        BigInt(latest.accruedQuoteAmount) -
          BigInt(latest.claimedQuoteAmount) !==
          BigInt(props.claimableRawAmount) ||
        BigInt(latest.proceedsVaultRawAmount) < BigInt(props.claimableRawAmount)
      )
        throw new Error('available amount changed');
      const prepared = await ownerTokenDestination({
        owner: props.owner,
        mint: props.quoteMint,
        tokenProgram: props.quoteTokenProgram,
      });
      if (prepared.address !== destination)
        throw new Error('destination changed');
      const instruction = await claimPlanProceedsInstruction({
        programAddress: address(props.programAddress),
        owner: address(props.owner),
        market: address(props.market),
        plan: address(props.plan),
        quoteMint: address(props.quoteMint),
        quoteTokenProgram: address(props.quoteTokenProgram),
        proceedsVault: address(props.proceedsVault),
        ownerQuoteDestination: address(destination),
        rawAmount: BigInt(props.claimableRawAmount),
      });
      const destinationAccount = await solanaClient.rpc
        .getAccountInfo(address(destination), {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send();
      const beforeAmount = destinationAccount.value
        ? (
            await solanaClient.rpc
              .getTokenAccountBalance(address(destination))
              .send()
          ).value.amount
        : '0';
      await simulateWalletTransaction([
        prepared.createInstruction,
        instruction,
      ]);
      setProgress('Awaiting approval…');
      sent = true;
      setSubmitted(true);
      await solanaClient.sendTransaction([
        prepared.createInstruction,
        instruction,
      ]);
      setProgress('Checking confirmation…');
      const [response, afterDestination] = await Promise.all([
        fetch(`/api/sell-plans/${props.plan}`, { cache: 'no-store' }),
        solanaClient.rpc.getTokenAccountBalance(address(destination)).send(),
      ]);
      if (!response.ok) throw new Error('confirmation unavailable');
      const updated = (await response.json()) as {
        accruedQuoteAmount: string;
        claimedQuoteAmount: string;
      };
      if (
        BigInt(updated.claimedQuoteAmount) <
          BigInt(props.claimedRawAmount) + BigInt(props.claimableRawAmount) ||
        BigInt(updated.accruedQuoteAmount) <
          BigInt(updated.claimedQuoteAmount) ||
        BigInt(afterDestination.value.amount) - BigInt(beforeAmount) !==
          BigInt(props.claimableRawAmount)
      )
        throw new Error('confirmation uncertain');
      setDestination(undefined);
      setProgress(undefined);
      router.refresh();
    } catch {
      setProgress(undefined);
      setError(
        sent
          ? "We're checking whether your transaction completed. Refresh this Plan before trying again."
          : 'The available amount or destination may have changed. Refresh this Plan and review again.',
      );
    }
  };

  return (
    <section
      className="mt-8 border-t border-line-default pt-5"
      aria-live="polite"
    >
      <h2 className="text-lg font-medium text-text-primary">Ready to claim</h2>
      <p className="mt-2 text-sm text-text-secondary">
        {formatDisplayAmount(props.claimableRawAmount, props.quoteDecimals)}{' '}
        {props.quoteSymbol} is available from this Plan.
      </p>
      {destination ? (
        <div className="mt-4 text-sm">
          <p className="text-text-secondary">
            Devnet · your wallet pays the network fee
          </p>
          <p className="mt-1 break-all font-mono text-xs text-text-tertiary">
            Destination: {destination}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={Boolean(progress) || submitted}
              className="min-h-11 border border-line-strong bg-surface-3 px-4 text-text-primary disabled:text-text-disabled"
            >
              Approve claim
            </button>
            <button
              type="button"
              onClick={() => setDestination(undefined)}
              disabled={Boolean(progress)}
              className="min-h-11 border border-line-default px-4 text-text-primary"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={submitted}
          className="mt-4 min-h-11 border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          Claim proceeds
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
          onClick={() => window.location.reload()}
          className="mt-3 min-h-11 text-sm text-text-primary underline"
        >
          Refresh status
        </button>
      ) : null}
    </section>
  );
}
