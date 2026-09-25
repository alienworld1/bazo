'use client';

import { useEffect, useState } from 'react';

export function ShareDisplayUpdate({
  mint,
  multiplier,
}: {
  mint: string;
  multiplier: string;
}) {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const key = `bazo:share-display:${mint}`;
    let differs = false;
    try {
      const previous = window.localStorage.getItem(key);
      differs = previous !== null && previous !== multiplier;
      window.localStorage.setItem(key, multiplier);
    } catch {
      differs = false;
    }
    const timer = window.setTimeout(() => setChanged(differs), 0);
    return () => window.clearTimeout(timer);
  }, [mint, multiplier]);
  return changed ? (
    <p
      role="status"
      className="mt-4 border-l-2 border-line-strong pl-3 text-sm text-text-secondary"
    >
      Displayed share amounts updated. Your Plan&apos;s raw allocation has not
      changed.
    </p>
  ) : null;
}
