'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  cancelBuyRequestInstruction,
  refundBuyRequestInstruction,
} from '@bazo/sdk';
import { solanaClient } from '@/components/solana-client';
import type { PublicBuyRequest } from '@/lib/buy-request-projection';
import { forgetBuyRequestOpening } from './private-buy-request-memory';
import { simulateBuyRequest } from './simulate-buy-request';

type Props = {
  request: PublicBuyRequest;
  escrowRawAmount: string;
  marketId: string;
  programAddress: string;
  quoteMint: string;
  quoteTokenProgram: string;
  expired: boolean;
};

export function BuyRequestActions({
  request,
  escrowRawAmount,
  marketId,
  programAddress,
  quoteMint,
  quoteTokenProgram,
  expired,
}: Props) {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [review, setReview] = useState<'cancel' | 'refund'>();
  const [destination, setDestination] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  if (request.status !== 'active') return null;
  if (!connected || connected.account.address !== request.buyer) {
    return (
      <p className="mt-8 text-sm text-text-secondary">
        Reconnect the wallet that owns this Buy Request to recover unused quote.
      </p>
    );
  }
  if (request.lockedBatch) {
    return (
      <p className="mt-8 text-sm text-text-secondary">
        This request is locked for matching. Try again after the Batch resolves.
      </p>
    );
  }

  const prepare = async (action: 'cancel' | 'refund') => {
    setError(undefined);
    try {
      const response = await fetch(
        `/api/markets/${marketId}/quote-balance?owner=${encodeURIComponent(request.buyer)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('quote account unavailable');
      const balance = (await response.json()) as {
        sourceTokenAccount: string | null;
      };
      if (!balance.sourceTokenAccount)
        throw new Error('quote account unavailable');
      setDestination(balance.sourceTokenAccount);
      setReview(action);
    } catch {
      setError("We couldn't prepare the return account. Nothing moved.");
    }
  };

  const submit = async () => {
    if (!review || !destination || progress) return;
    const action = review;
    setProgress('Preparing transaction…');
    setError(undefined);
    try {
      const input = {
        programAddress: address(programAddress),
        buyer: address(request.buyer),
        market: address(request.market),
        quoteMint: address(quoteMint),
        quoteTokenProgram: address(quoteTokenProgram),
        request: address(request.address),
        escrow: address(request.escrow),
        buyerQuoteDestination: address(destination),
      };
      const instruction =
        action === 'cancel'
          ? await cancelBuyRequestInstruction(input)
          : await refundBuyRequestInstruction(input);
      const beforeDestination = await solanaClient.rpc
        .getTokenAccountBalance(address(destination))
        .send();
      await simulateBuyRequest([instruction]);
      setProgress('Awaiting approval…');
      await solanaClient.sendTransaction([instruction]);
      setProgress('Verifying return…');
      const [response, afterDestination] = await Promise.all([
        fetch(`/api/buy-requests/${request.address}`, { cache: 'no-store' }),
        solanaClient.rpc.getTokenAccountBalance(address(destination)).send(),
      ]);
      if (!response.ok) throw new Error('verification unavailable');
      const updated = (await response.json()) as PublicBuyRequest & {
        escrowRawAmount: string;
      };
      if (
        updated.status !== (action === 'cancel' ? 'canceled' : 'expired') ||
        updated.escrowRawAmount !== '0' ||
        BigInt(afterDestination.value.amount) -
          BigInt(beforeDestination.value.amount) !==
          BigInt(escrowRawAmount)
      )
        throw new Error('verification mismatch');
      forgetBuyRequestOpening(request.address);
      setProgress(undefined);
      setReview(undefined);
      router.refresh();
    } catch {
      setProgress(undefined);
      setError(
        "We couldn't verify the return yet. Refresh this request before trying again.",
      );
    }
  };

  return (
    <div className="mt-8">
      {review && destination ? (
        <div className="border-y border-line-default py-5 text-sm">
          <h2 className="font-medium text-text-primary">
            {review === 'cancel' ? 'Cancel request' : 'Claim refund'}
          </h2>
          <p className="mt-2 text-text-secondary">
            Return {escrowRawAmount} raw quote units from this request&apos;s
            escrow to your account.
          </p>
          <p className="mt-2 break-all font-mono text-text-tertiary">
            Destination: {destination}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={Boolean(progress)}
              className="min-h-12 border border-line-strong bg-surface-3 px-5 text-text-primary disabled:text-text-disabled"
            >
              Approve return
            </button>
            <button
              type="button"
              onClick={() => setReview(undefined)}
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
          onClick={() => void prepare(expired ? 'refund' : 'cancel')}
          className="min-h-11 border border-line-default px-4 text-sm text-text-primary"
        >
          {expired ? 'Claim refund' : 'Cancel request'}
        </button>
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
    </div>
  );
}
