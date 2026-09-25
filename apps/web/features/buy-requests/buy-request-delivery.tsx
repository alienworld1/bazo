'use client';

import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useEffect, useState } from 'react';
import type { PublicBuyRequest } from '@bazo/sdk';
import { solanaClient } from '@/components/solana-client';
import { deliverBuyRequestOpening } from './deliver-buy-request-opening';
import { getVerifiedBuyRequestOpening } from './private-buy-request-memory';

export function BuyRequestDelivery({
  request,
  matchingWindowOpen,
}: {
  request: PublicBuyRequest;
  matchingWindowOpen: boolean;
}) {
  const connected = useConnectedWallet(solanaClient);
  const [status, setStatus] = useState<
    'checking' | 'needed' | 'delivered' | 'sending'
  >('checking');
  const [error, setError] = useState<string>();
  const isOwner = connected?.account.address === request.buyer;

  useEffect(() => {
    if (
      !isOwner ||
      !matchingWindowOpen ||
      request.lockedBatch ||
      request.status !== 'active'
    )
      return;
    let alive = true;
    fetch(`/api/buy-requests/${request.address}/opening`, { cache: 'no-store' })
      .then(response =>
        response.ok
          ? (response.json() as Promise<{ delivered: boolean }>)
          : { delivered: false },
      )
      .then(result => {
        if (alive) setStatus(result.delivered ? 'delivered' : 'needed');
      })
      .catch(() => {
        if (alive) setStatus('needed');
      });
    return () => {
      alive = false;
    };
  }, [
    isOwner,
    matchingWindowOpen,
    request.address,
    request.lockedBatch,
    request.status,
  ]);

  if (request.status !== 'active' || request.lockedBatch || !matchingWindowOpen)
    return null;
  if (!isOwner)
    return (
      <p className="mt-8 border-t border-line-default pt-5 text-sm text-text-secondary">
        Connect the wallet that owns this request to provide matching details.
      </p>
    );
  const deliver = async () => {
    setError(undefined);
    setStatus('sending');
    try {
      const opening = await getVerifiedBuyRequestOpening(
        request.address,
        request.buyer,
        request.commitmentHex,
      );
      if (!opening) throw new Error('opening unavailable');
      await deliverBuyRequestOpening(opening);
      setStatus('delivered');
    } catch {
      setStatus('needed');
      setError(
        'Matching details need attention. Retry delivery from this browser while your opening is available.',
      );
    }
  };

  return (
    <section
      className="mt-8 border-t border-line-default pt-5"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-text-primary">
        {status === 'checking'
          ? 'Checking matching details…'
          : status === 'delivered'
            ? 'Collecting requests'
            : 'Matching details need attention'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {status === 'checking'
          ? 'Checking whether your verified details reached the coordinator.'
          : status === 'delivered'
            ? 'Your verified details reached the coordinator. Your funded request remains onchain.'
            : 'Provide your private matching details before this request can be considered.'}
      </p>
      {status !== 'delivered' ? (
        <button
          type="button"
          onClick={() => void deliver()}
          disabled={status === 'sending' || status === 'checking'}
          className="mt-4 min-h-11 border border-line-strong bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          {status === 'sending'
            ? 'Sending details…'
            : 'Provide matching details'}
        </button>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
