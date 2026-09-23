'use client';

import type { NormalizedReference } from '@/lib/markets';
import { useBuyReference } from '@/features/buy-requests/use-buy-reference';

const copy: Record<NormalizedReference['status'], string> = {
  valid: 'Reference fresh',
  stale: 'Waiting for a fresh underlying reference',
  closed: 'Underlying market closed',
  session_not_allowed: "This market session isn't supported.",
  insufficient_publishers: 'Reference verification is incomplete',
  confidence_too_wide: 'Reference uncertainty is too high',
  feed_mismatch: 'The underlying reference could not be verified.',
  unavailable:
    "Underlying reference temporarily unavailable. Market availability can't be confirmed.",
  invalid: 'The underlying reference could not be verified.',
};

export function ReferenceStatus({
  marketId,
  state,
}: {
  marketId: string;
  state?: ReturnType<typeof useBuyReference>;
}) {
  const localState = useBuyReference(marketId, !state);
  const { reference, loading, error, reload } = state ?? localState;
  if (loading && !reference)
    return (
      <p aria-live="polite" className="text-sm text-text-secondary">
        Loading underlying reference…
      </p>
    );
  if (error)
    return (
      <div aria-live="assertive" className="border-l-2 border-warning pl-3">
        <p className="text-sm text-text-primary">
          Underlying reference temporarily unavailable. Market availability
          can&apos;t be confirmed.
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-2 text-sm text-text-primary underline"
        >
          Retry
        </button>
      </div>
    );
  if (!reference) return null;
  return (
    <div aria-live="polite" className="border-l-2 border-info pl-3">
      <p className="font-mono text-2xl tabular-nums text-text-primary">
        {reference.formattedPrice}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {copy[reference.status]} ·{' '}
        {reference.marketSession === 'regular'
          ? 'Regular session'
          : reference.marketSession}
      </p>
      <p className="mt-1 font-mono text-xs text-text-tertiary">
        Updated{' '}
        {new Date(
          Number(reference.feedUpdateTimestamp) * 1000,
        ).toLocaleString()}
      </p>
    </div>
  );
}
