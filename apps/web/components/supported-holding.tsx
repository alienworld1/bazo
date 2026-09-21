'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import type { PublicMarket } from '@/lib/markets';
import type { SupportedHolding as SupportedHoldingData } from '@/lib/markets';
import { solanaClient } from './solana-client';

export function SupportedHolding({ market }: { market: PublicMarket }) {
  const connected = useConnectedWallet(solanaClient);
  const [holding, setHolding] = useState<SupportedHoldingData>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const owner = connected?.account.address;
  const load = useCallback(async () => {
    if (!owner) return;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/markets/${market.id}/holding?owner=${encodeURIComponent(owner)}`,
      );
      if (!response.ok) throw new Error('holding read failed');
      setHolding(await response.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [market.id, owner]);

  useEffect(() => {
    if (owner) void Promise.resolve().then(load);
  }, [load, owner]);

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
  if (error)
    return (
      <section
        className="border-y border-line-default py-8"
        aria-live="assertive"
      >
        <p className="text-text-secondary">
          Holdings are temporarily unavailable. Nothing in your wallet changed.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="mt-4 min-h-11 text-sm text-text-primary underline disabled:text-text-disabled"
        >
          Retry
        </button>
      </section>
    );
  if (loading || !holding || holding.owner !== owner)
    return (
      <section className="border-y border-line-default py-8" aria-live="polite">
        <p className="text-sm text-text-secondary">
          Reading supported holdings…
        </p>
      </section>
    );
  if (holding.rawAmount === '0')
    return (
      <section className="border-y border-line-default py-8">
        <h1 className="text-2xl font-medium text-text-primary">
          No supported stock found in this wallet.
        </h1>
        <p className="mt-3 text-text-secondary">
          Bazo only shows positions available in its supported Markets.
        </p>
      </section>
    );
  return (
    <section className="border-y border-line-default py-8" aria-live="polite">
      <h1 className="mt-2 text-2xl font-medium text-text-primary">
        {holding.displayAmount} {holding.displaySymbol}
      </h1>
      <p className="mt-2 text-text-secondary">Supported holding on Devnet</p>
      <Link
        href={`/markets/${market.id}`}
        className="mt-5 inline-flex min-h-11 items-center rounded border border-line-default px-4 text-sm text-text-primary hover:border-line-strong"
      >
        View market
      </Link>
      <Link
        href={`/sell-plans/new?market=${market.id}`}
        className="ml-3 inline-flex min-h-11 items-center rounded border border-line-strong bg-surface-3 px-4 text-sm text-text-primary hover:border-focus"
      >
        Create Sell Plan
      </Link>
    </section>
  );
}
