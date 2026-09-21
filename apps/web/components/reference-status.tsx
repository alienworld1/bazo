'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NormalizedReference } from '@/lib/markets';

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

export function ReferenceStatus({ marketId }: { marketId: string }) {
  const [reference, setReference] = useState<NormalizedReference>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/markets/${marketId}/reference`);
      if (!response.ok) throw new Error();
      setReference(await response.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [marketId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
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
          onClick={() => void load()}
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
