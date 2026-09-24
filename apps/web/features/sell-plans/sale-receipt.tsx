import Link from 'next/link';
import type { ConfirmedSale } from '@/server/settlements';
import { PlanFact } from './plan-fact';

export function SaleReceipt({ sale }: { sale: ConfirmedSale }) {
  const { receipt, signature } = sale;
  return (
    <section className="mt-8 border-t border-line-default pt-5">
      <h2 className="text-lg font-medium text-text-primary">Stage sold</h2>
      <p className="mt-2 text-sm text-text-secondary">
        {receipt.rawStockQuantity} raw stock units sold for{' '}
        {receipt.rawQuoteQuantity} raw quote units at a{' '}
        {receipt.clearingPremiumBps} bps premium.
      </p>
      <details className="mt-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 text-text-primary">
          View sale details
        </summary>
        <dl className="mt-3 space-y-3 break-all font-mono text-xs text-text-secondary">
          <PlanFact label="Stage" value={String(receipt.stageIndex + 1)} />
          <PlanFact
            label="Reference"
            value={`${receipt.referencePrice} × 10^${receipt.referenceExponent}`}
          />
          <PlanFact label="Feed" value={receipt.pythFeedId} />
          <PlanFact
            label="Feed update"
            value={new Date(
              Number(BigInt(receipt.feedUpdateTimestampUs) / 1000n),
            ).toLocaleString()}
          />
          <PlanFact
            label="Session mask"
            value={String(receipt.referenceSessionMask)}
          />
          <PlanFact
            label="Publishers"
            value={String(receipt.referencePublisherCount)}
          />
          <PlanFact label="Confidence" value={receipt.referenceConfidence} />
          <PlanFact label="Batch" value={receipt.batch} />
          <PlanFact label="Plan" value={receipt.plan} />
          <PlanFact label="Receipt" value={receipt.address} />
          {signature ? (
            <PlanFact label="Confirmed transaction" value={signature} />
          ) : null}
          {receipt.fills.map(fill => (
            <PlanFact
              key={fill.request}
              label="Buyer fill"
              value={`${fill.request}: ${fill.rawStockQuantity} stock raw, ${fill.rawQuoteCharge} quote raw`}
            />
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link
            href={`/batches/${receipt.batch}`}
            className="min-h-11 py-3 text-text-primary underline"
          >
            View Batch
          </Link>
          {receipt.fills.map(fill => (
            <Link
              key={fill.request}
              href={`/buy-requests/${fill.request}`}
              className="min-h-11 py-3 text-text-primary underline"
            >
              View request
            </Link>
          ))}
          {signature ? (
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 py-3 text-text-primary underline"
            >
              View transaction
            </a>
          ) : null}
        </div>
      </details>
    </section>
  );
}
