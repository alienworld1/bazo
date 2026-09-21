'use client';

import Link from 'next/link';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import type { PublicMarket } from '@/lib/markets';
import { solanaClient } from './solana-client';

export function SupportedHolding({ market }: { market: PublicMarket }) {
  const connected = useConnectedWallet(solanaClient);
  if (!connected)
    return (
      <section className="border-y border-line-default py-8">
        <h1 className="text-2xl font-medium text-text-primary">
          Your supported holdings
        </h1>
        <p className="mt-3 text-text-secondary">
          Connect a Solana wallet to see supported holdings.
        </p>
      </section>
    );
  return (
    <section className="border-y border-line-default py-8" aria-live="polite">
      <p className="text-sm text-text-secondary">Reading supported holdings…</p>
      <h1 className="mt-2 text-2xl font-medium text-text-primary">
        {market.symbol}
      </h1>
      <p className="mt-2 text-text-secondary">
        Holdings are read directly from the configured Devnet Market.
      </p>
      <Link
        href={`/markets/${market.id}`}
        className="mt-5 inline-flex min-h-11 items-center rounded border border-line-default px-4 text-sm text-text-primary hover:border-line-strong"
      >
        View market
      </Link>
    </section>
  );
}
