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
import { simulateWalletTransaction } from '@/components/simulate-wallet-transaction';
import { ownerTokenDestination } from '@/components/owner-token-destination';
import { formatDisplayAmount } from '@/lib/token-amounts';

type Props = {
  request: PublicBuyRequest;
  escrowRawAmount: string;
  programAddress: string;
  quoteMint: string;
  quoteTokenProgram: string;
  quoteSymbol: string;
  quoteDecimals: number;
  expired: boolean;
};

export function BuyRequestActions({
  request,
  escrowRawAmount,
  programAddress,
  quoteMint,
  quoteTokenProgram,
  quoteSymbol,
  quoteDecimals,
  expired,
}: Props) {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [review, setReview] = useState<'cancel' | 'refund'>();
  const [destination, setDestination] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  if (
    (request.status !== 'active' && request.status !== 'filled') ||
    (request.status === 'filled' && escrowRawAmount === '0')
  )
    return null;
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
      const prepared = await ownerTokenDestination({
        owner: request.buyer,
        mint: quoteMint,
        tokenProgram: quoteTokenProgram,
      });
      setDestination(prepared.address);
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
      const prepared = await ownerTokenDestination({
        owner: request.buyer,
        mint: quoteMint,
        tokenProgram: quoteTokenProgram,
      });
      if (prepared.address !== destination)
        throw new Error('destination changed');
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
      await solanaClient.sendTransaction([
        prepared.createInstruction,
        instruction,
      ]);
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
        updated.status !==
          (action === 'cancel'
            ? 'canceled'
            : request.status === 'filled'
              ? 'closed'
              : 'expired') ||
        updated.escrowRawAmount !== '0' ||
        BigInt(afterDestination.value.amount) - BigInt(beforeAmount) !==
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
            {review === 'cancel' ? 'Cancel request' : 'Refund unused quote'}
          </h2>
          <p className="mt-2 text-text-secondary">
            Return {formatDisplayAmount(escrowRawAmount, quoteDecimals)}{' '}
            {quoteSymbol} ({escrowRawAmount} raw units) from this request&apos;s
            escrow to your account.
          </p>
          <p className="mt-2 text-text-secondary">
            Devnet · your wallet pays the network fee and may create its quote
            account.
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
          onClick={() =>
            void prepare(
              expired || request.status === 'filled' ? 'refund' : 'cancel',
            )
          }
          className="min-h-11 border border-line-default px-4 text-sm text-text-primary"
        >
          {expired || request.status === 'filled'
            ? 'Refund unused quote'
            : 'Cancel request'}
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
