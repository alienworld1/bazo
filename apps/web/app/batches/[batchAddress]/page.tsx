import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { PlanFact } from '@/features/sell-plans/plan-fact';
import { readBatch, readBatchAvailability } from '@/server/batches';
import { readChainUnixTimestamp } from '@/server/buy-requests';
import { BatchActions } from '@/features/batches/batch-actions';
import { getEnvironment } from '@/server/env';

export const dynamic = 'force-dynamic';

export default async function BatchPage({
  params,
}: {
  params: Promise<{ batchAddress: string }>;
}) {
  const { batchAddress } = await params;
  const batch = await readBatch(batchAddress);
  if (!batch) notFound();
  const [chainTime, availability] = await Promise.all([
    readChainUnixTimestamp(),
    readBatchAvailability(batchAddress),
  ]);
  const released = batch.status === 'expired';
  const releaseAvailable =
    batch.status === 'locked' && chainTime >= BigInt(batch.lockDeadline);
  const status = released
    ? 'This Batch ended without a sale.'
    : releaseAvailable
      ? 'Lock expired'
      : batch.status === 'open'
        ? 'Collecting requests'
        : availability === 'match_ready'
          ? 'Match ready'
          : availability === 'candidate_pending_reference'
            ? 'Waiting for valid market reference'
            : 'Matching';
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl border-y border-line-default py-8">
        <p className="font-mono text-xs text-text-tertiary">BATCH</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          {status}
        </h1>
        <p
          className="mt-3 min-h-12 text-sm text-text-secondary"
          aria-live="polite"
        >
          {released
            ? 'Requests can be considered again while they remain active. No sale completed.'
            : releaseAvailable
              ? 'Release this Batch to make its active requests usable again. No sale completed.'
              : batch.status === 'open'
                ? 'Requests are being collected. The fixed set appears when this Batch locks.'
                : availability === 'match_ready'
                  ? 'A complete match proposal is available. Quote affordability still needs settlement verification. No sale has completed yet.'
                  : availability === 'candidate_pending_reference'
                    ? 'A structural match is waiting for verified market data. No sale has completed yet.'
                    : 'The request set is fixed while matching is checked. No sale has completed yet.'}
        </p>
        <dl className="mt-8 space-y-4 text-sm">
          <PlanFact label="Market" value={batch.market} />
          <PlanFact
            label="Requests in set"
            value={batch.requests.length.toString()}
          />
          <PlanFact
            label="Window opens"
            value={formatTime(batch.windowStart)}
          />
          <PlanFact
            label="This Batch closes"
            value={formatTime(batch.windowEnd)}
          />
          {batch.status === 'locked' ? (
            <PlanFact
              label="Lock releases after"
              value={formatTime(batch.lockDeadline)}
            />
          ) : null}
        </dl>
        <BatchActions
          batch={batch}
          chainTime={chainTime.toString()}
          programAddress={getEnvironment().BAZO_PROGRAM_ID}
        />
        <details className="mt-8 border-t border-line-default pt-5 text-sm">
          <summary className="cursor-pointer text-text-primary">
            View technical details
          </summary>
          <dl className="mt-4 space-y-3 font-mono text-xs text-text-secondary">
            <PlanFact label="Batch" value={batch.address} />
            <PlanFact label="Created slot" value={batch.createdSlot} />
            <PlanFact
              label="Lock slot"
              value={batch.lockSlot ?? 'Not locked'}
            />
            <PlanFact label="Lock deadline" value={batch.lockDeadline} />
            {batch.requests.map((request, index) => (
              <PlanFact
                key={request}
                label={`Request ${index + 1}`}
                value={request}
              />
            ))}
          </dl>
        </details>
        <div className="mt-8 flex flex-wrap gap-4">
          {batch.requests.map(request => (
            <Link
              key={request}
              href={`/buy-requests/${request}`}
              className="min-h-11 py-3 text-sm text-text-primary underline"
            >
              View request
            </Link>
          ))}
          <Link
            href="/markets"
            className="min-h-11 py-3 text-sm text-text-primary underline"
          >
            View Markets
          </Link>
        </div>
      </article>
    </AppShell>
  );
}

function formatTime(unix: string): string {
  return new Date(Number(unix) * 1_000).toLocaleString();
}
