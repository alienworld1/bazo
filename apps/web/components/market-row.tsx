import Link from 'next/link';
import type { PublicMarket } from '@/lib/markets';
import { ReferenceStatus } from './reference-status';

export function MarketRow({ market }: { market: PublicMarket }) {
  return (
    <article className="grid gap-5 border-y border-line-default py-5 md:grid-cols-[1fr_1.1fr_auto] md:items-center">
      <div>
        <p className="font-mono text-xs text-text-tertiary">
          {market.symbol} / {market.quoteSymbol}
        </p>
        <h2 className="mt-1 text-xl font-medium text-text-primary">
          {market.displayName}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">Devnet test asset</p>
      </div>
      <ReferenceStatus marketId={market.id} />
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/markets/${market.id}`}
          className="inline-flex min-h-11 items-center justify-center rounded border border-line-default px-4 text-sm text-text-primary hover:border-line-strong"
        >
          View market
        </Link>
        <Link
          href={`/sell-plans/new?market=${market.id}`}
          className="inline-flex min-h-11 items-center justify-center rounded border border-line-strong bg-surface-3 px-4 text-sm text-text-primary hover:border-focus"
        >
          Create plan
        </Link>
      </div>
    </article>
  );
}
