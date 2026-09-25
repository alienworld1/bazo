import type { MarketConfig } from '@/lib/markets';
import { formatDisplayAmount } from '@/lib/token-amounts';
import { BuyRequestFact } from './buy-request-fact';
import type { PreparedBuyRequest } from './buy-request-types';

export function BuyRequestReview({
  market,
  prepared,
  status,
  error,
  uncertain,
  onPlace,
  onBack,
  onVerify,
}: {
  market: MarketConfig;
  prepared: PreparedBuyRequest;
  status?: string;
  error?: string;
  uncertain: boolean;
  onPlace: () => void;
  onBack: () => void;
  onVerify: () => void;
}) {
  return (
    <section className="mx-auto max-w-3xl rounded-[14px] border border-line-default bg-surface-2 p-6">
      <p className="font-mono text-xs text-text-tertiary">REVIEW REQUEST</p>
      <h1 className="mt-3 text-3xl font-medium text-text-primary">
        Review your Buy Request
      </h1>
      <dl className="mt-8 space-y-3 text-sm">
        <BuyRequestFact label="Network" value="Solana Devnet" />
        <BuyRequestFact
          label="Buyer and fee payer"
          value={prepared.opening.buyer}
        />
        <BuyRequestFact
          label="Market"
          value={`${market.displayName} (${prepared.opening.market})`}
        />
        <BuyRequestFact
          label="Maximum quantity"
          value={`${formatDisplayAmount(prepared.quantityRaw.toString(), market.tokenDecimals, prepared.multiplier)} ${market.symbol} (${prepared.quantityRaw} raw)`}
        />
        <BuyRequestFact
          label="Maximum premium to Pyth"
          value={formatPremium(prepared.premiumBps)}
        />
        <BuyRequestFact
          label="Quote to lock"
          value={`${formatDisplayAmount(prepared.quoteRaw.toString(), prepared.quoteDecimals)} ${market.quoteSymbol} (${prepared.quoteRaw} raw)`}
        />
        <BuyRequestFact
          label="Quote balance after funding"
          value={`${formatDisplayAmount(prepared.balanceAfter.toString(), prepared.quoteDecimals)} ${market.quoteSymbol} (${prepared.balanceAfter} raw)`}
        />
        <BuyRequestFact
          label="Current indicative ceiling"
          value={prepared.referenceLabel}
        />
        <BuyRequestFact
          label="Partial fills"
          value={prepared.opening.allowPartialFills ? 'Allowed' : 'Not allowed'}
        />
        <BuyRequestFact
          label="Recipient account setup"
          value="Create the Token-2022 receiving account if needed"
        />
        <BuyRequestFact
          label="Simulation"
          value="Passed for this reviewed request"
        />
        <BuyRequestFact
          label="Request expires"
          value={new Date(Number(prepared.expiresAt) * 1000).toLocaleString()}
        />
        <BuyRequestFact
          label="Stock recipient"
          value={prepared.opening.recipient}
        />
        <BuyRequestFact
          label="Quote source"
          value={prepared.sourceTokenAccount}
        />
        <BuyRequestFact label="Request address" value={prepared.request} />
        <BuyRequestFact label="Escrow address" value={prepared.escrow} />
      </dl>
      <p className="mt-6 text-sm text-text-secondary">
        This locks{' '}
        {formatDisplayAmount(
          prepared.quoteRaw.toString(),
          prepared.quoteDecimals,
        )}{' '}
        {market.quoteSymbol}. Your final price is limited by your premium and
        the funds held for this request.
      </p>
      <p className="mt-3 text-sm text-text-secondary">
        This request can enter one Batch. If it ends without a sale, you can
        cancel the request to return unused quote after its lock is released.
      </p>
      {status ? (
        <p className="mt-4 text-sm text-text-secondary" aria-live="polite">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPlace}
          disabled={Boolean(status) || uncertain}
          className="min-h-12 border border-line-strong bg-surface-3 px-5 text-sm text-text-primary disabled:text-text-disabled"
        >
          Place request
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={Boolean(status) || uncertain}
          className="min-h-11 border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          Back to edit
        </button>
      </div>
      {uncertain ? (
        <button
          type="button"
          onClick={onVerify}
          disabled={Boolean(status)}
          className="mt-4 min-h-11 border border-line-default px-4 text-sm text-text-primary"
        >
          Retry verification
        </button>
      ) : null}
    </section>
  );
}

function formatPremium(bps: number): string {
  return `${bps >= 0 ? '+' : '-'}${(Math.abs(bps) / 100).toFixed(2)}% (${bps >= 0 ? '+' : ''}${bps} bps)`;
}
