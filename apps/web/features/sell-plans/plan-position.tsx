import { formatDisplayAmount } from '@/lib/token-amounts';
import type { MarketConfig } from '@/lib/markets';
import type { VerifiedPublicSellPlan } from '@/server/plans';

export function PlanPosition({
  plan,
  market,
  multiplier,
}: {
  plan: VerifiedPublicSellPlan;
  market: MarketConfig;
  multiplier: string;
}) {
  const sold = BigInt(plan.soldRawInventory);
  const returned =
    BigInt(plan.initialRawInventory) -
    BigInt(plan.remainingRawInventory) -
    sold;
  const claimable =
    BigInt(plan.accruedQuoteAmount) - BigInt(plan.claimedQuoteAmount);
  if (
    sold < 0n ||
    returned < 0n ||
    claimable < 0n ||
    claimable > BigInt(plan.proceedsVaultRawAmount)
  )
    return (
      <p
        role="alert"
        className="mt-8 border-l-2 border-warning pl-3 text-warning"
      >
        We couldn&apos;t verify this balance right now. Try again.
      </p>
    );
  const stock = (raw: string) =>
    `${formatDisplayAmount(raw, market.tokenDecimals, multiplier)} ${market.symbol}`;
  return (
    <section
      aria-label="Plan position"
      className="mt-8 border-y border-line-default py-6"
    >
      <p className="text-xs uppercase tracking-widest text-text-tertiary">
        Remaining
      </p>
      <p className="mt-2 font-mono text-3xl tabular-nums text-text-primary">
        {stock(plan.remainingRawInventory)}
      </p>
      <dl className="mt-6 grid gap-5 border-t border-line-subtle pt-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-text-tertiary">Sold</dt>
          <dd className="mt-1 font-mono tabular-nums text-text-primary">
            {stock(sold.toString())}
          </dd>
        </div>
        <div>
          <dt className="text-text-tertiary">Proceeds ready to claim</dt>
          <dd className="mt-1 font-mono tabular-nums text-text-primary">
            {formatDisplayAmount(claimable.toString(), plan.quoteDecimals)}{' '}
            {market.quoteSymbol}
          </dd>
        </div>
        <div>
          <dt className="text-text-tertiary">Total committed</dt>
          <dd className="mt-1 font-mono tabular-nums text-text-primary">
            {stock(plan.initialRawInventory)}
          </dd>
        </div>
      </dl>
      {returned > 0n ? (
        <p className="mt-5 text-sm text-text-secondary">
          Stock returned:{' '}
          <span className="font-mono tabular-nums text-text-primary">
            {stock(returned.toString())}
          </span>
        </p>
      ) : null}
    </section>
  );
}
