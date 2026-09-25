'use client';

import Link from 'next/link';
import type { PublicMarket } from '@/lib/markets';
import { formatDisplayAmount } from '@/lib/token-amounts';
import { useWalletPositions } from './use-wallet-positions';

export function WalletPositions({ markets }: { markets: PublicMarket[] }) {
  const { owner, data, loading, error, reload } = useWalletPositions();
  if (!owner)
    return (
      <p className="mt-8 text-text-secondary">
        Connect a Solana wallet to see your Sell Plans and requests.
      </p>
    );
  if (loading)
    return (
      <p className="mt-8 text-text-secondary" aria-live="polite">
        Reading your positions…
      </p>
    );
  if (error || !data)
    return (
      <div className="mt-8" role="alert">
        <p className="text-text-secondary">
          We couldn&apos;t load your positions. Try again.
        </p>
        <button
          className="mt-3 min-h-11 text-text-primary underline"
          onClick={reload}
        >
          Retry
        </button>
      </div>
    );

  return (
    <div className="mt-10 space-y-10">
      {data.partial ? (
        <p
          role="status"
          className="border-l-2 border-warning pl-3 text-sm text-warning"
        >
          Some positions couldn&apos;t be verified. Refresh to check again.
        </p>
      ) : null}
      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-medium">Sell Plans</h2>
          <button className="min-h-11 text-sm underline" onClick={reload}>
            Refresh
          </button>
        </div>
        {data.plans.length === 0 ? (
          <p className="mt-4 text-text-secondary">
            {data.partial
              ? 'We couldn\u2019t verify all Sell Plans yet. Refresh to check again.'
              : 'No Sell Plans found for this wallet. Put part of a supported position to work when you\u2019re ready.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-default border-y border-line-default">
            {data.plans.map(plan => {
              const market = markets.find(
                item =>
                  item.stockMint === plan.stockVaultMint &&
                  item.quoteMint === plan.proceedsVaultMint,
              );
              if (!market) return null;
              const sold =
                BigInt(plan.initialRawInventory) -
                BigInt(plan.remainingRawInventory);
              const claimable =
                BigInt(plan.accruedQuoteAmount) -
                BigInt(plan.claimedQuoteAmount);
              const valid =
                sold >= 0n &&
                claimable >= 0n &&
                claimable <= BigInt(plan.proceedsVaultRawAmount);
              return (
                <li key={plan.address} className="py-5">
                  <Link
                    href={`/sell-plans/${plan.address}`}
                    className="inline-flex min-h-11 items-center text-lg font-medium underline decoration-line-strong underline-offset-4"
                  >
                    {market.symbol} Sell Plan
                  </Link>
                  <p className="text-sm text-text-secondary">
                    {plan.status === 'active' ? 'Active' : plan.status} · Stage{' '}
                    {plan.currentStageIndex + 1}
                  </p>
                  {valid ? (
                    <p className="mt-2 font-mono text-sm tabular-nums text-text-primary">
                      {formatDisplayAmount(
                        plan.remainingRawInventory,
                        market.tokenDecimals,
                        data.multipliers[market.id] ?? '1',
                      )}{' '}
                      {market.symbol} remaining ·{' '}
                      {formatDisplayAmount(
                        sold.toString(),
                        market.tokenDecimals,
                        data.multipliers[market.id] ?? '1',
                      )}{' '}
                      sold ·{' '}
                      {formatDisplayAmount(
                        claimable.toString(),
                        plan.quoteDecimals,
                      )}{' '}
                      {market.quoteSymbol} ready to claim
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-warning">
                      We couldn&apos;t verify this balance right now. Try again.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-xl font-medium">Buy requests</h2>
        {data.requests.length === 0 ? (
          <p className="mt-4 text-text-secondary">
            {data.partial
              ? 'We couldn\u2019t verify all Buy Requests yet. Refresh to check again.'
              : 'No Buy Requests found for this wallet.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-default border-y border-line-default">
            {data.requests.map(request => (
              <li key={request.address} className="py-4">
                <Link
                  className="inline-flex min-h-11 items-center underline"
                  href={`/buy-requests/${request.address}`}
                >
                  Buy Request · {request.status}
                </Link>
                <p className="text-sm text-text-secondary">
                  {request.filledRawQuantity} raw stock delivered ·{' '}
                  {request.refundableQuoteAmount} raw quote refundable
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link
        href="/activity"
        className="inline-flex min-h-11 items-center text-text-primary underline"
      >
        View activity
      </Link>
    </div>
  );
}
