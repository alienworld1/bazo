'use client';

import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useEffect, useState } from 'react';
import { solanaClient } from '@/components/solana-client';
import type { PublicBuyRequest } from '@/lib/buy-request-projection';
import { formatDisplayAmount } from '@/lib/token-amounts';
import type { SupportedHolding } from '@/lib/markets';
import { getVerifiedBuyRequestOpening } from './private-buy-request-memory';

export function BuyRequestPrivateTerms({
  request,
  marketId,
  stockDecimals,
  symbol,
}: {
  request: PublicBuyRequest;
  marketId: string;
  stockDecimals: number;
  symbol: string;
}) {
  const connected = useConnectedWallet(solanaClient);
  const owner = connected?.account.address;
  const [terms, setTerms] = useState<{
    requested: string;
    remaining: string;
    premiumBps: number;
    partial: boolean;
    scaled: boolean;
  }>();

  useEffect(() => {
    let active = true;
    if (!owner || owner !== request.buyer) return;
    void (async () => {
      const opening = await getVerifiedBuyRequestOpening(
        request.address,
        owner,
        request.commitmentHex,
      );
      if (!opening) return;
      const response = await fetch(
        `/api/markets/${marketId}/holding?owner=${encodeURIComponent(owner)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const holding = (await response.json()) as SupportedHolding;
      const multiplier = holding.multiplierContext ?? '1';
      const remaining =
        opening.targetRawQuantity - BigInt(request.filledRawQuantity);
      if (remaining < 0n) return;
      if (active)
        setTerms({
          requested: formatDisplayAmount(
            opening.targetRawQuantity.toString(),
            stockDecimals,
            multiplier,
          ),
          remaining: formatDisplayAmount(
            remaining.toString(),
            stockDecimals,
            multiplier,
          ),
          premiumBps: opening.maxPremiumBps,
          partial: opening.allowPartialFills,
          scaled: multiplier !== '1',
        });
    })();
    return () => {
      active = false;
    };
  }, [
    marketId,
    owner,
    request.address,
    request.buyer,
    request.commitmentHex,
    request.filledRawQuantity,
    stockDecimals,
  ]);

  if (!owner || owner !== request.buyer || !terms) return null;
  return (
    <section className="mt-8 border-y border-line-default py-5 text-sm">
      <h2 className="font-medium text-text-primary">Your request details</h2>
      <p className="mt-3 text-text-secondary">
        Requested: {terms.requested} {symbol}
      </p>
      <p className="mt-2 text-text-secondary">
        Remaining: {terms.remaining} {symbol}
      </p>
      <p className="mt-2 text-text-secondary">
        Maximum premium: {terms.premiumBps >= 0 ? '+' : ''}
        {(terms.premiumBps / 100).toFixed(2)}%
      </p>
      <p className="mt-2 text-text-secondary">
        Partial fills: {terms.partial ? 'Allowed' : 'Not allowed'}
      </p>
      {terms.scaled ? (
        <p className="mt-3 text-text-tertiary">
          The stock display multiplier may change. Your raw request limit and
          escrow do not.
        </p>
      ) : null}
    </section>
  );
}
