'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NormalizedReference } from '@/lib/markets';

export function useBuyReference(marketId: string, enabled = true) {
  const [reference, setReference] = useState<NormalizedReference>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/markets/${marketId}/reference`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error();
      setReference(await response.json());
    } catch {
      setReference(undefined);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [marketId]);
  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(load);
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [enabled, load]);
  return { reference, loading, error, reload: load };
}
