'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NormalizedReference } from '@/lib/markets';

export function useBuyReference(marketId: string) {
  const [reference, setReference] = useState<NormalizedReference>();
  const load = useCallback(async () => {
    try { const response = await fetch(`/api/markets/${marketId}/reference`, { cache: 'no-store' }); if (!response.ok) throw new Error(); setReference(await response.json()); }
    catch { setReference(undefined); }
  }, [marketId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return reference;
}
