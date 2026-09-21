'use client';

import { useState } from 'react';
import type { PublicMarket } from '@/lib/markets';

export function TechnicalInspector({ market }: { market: PublicMarket }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string>();
  const entries = [
    ['Stock mint', market.stockMint],
    ['Stock token program', market.stockTokenProgram],
    ['Quote mint', market.quoteMint],
    ['Quote token program', market.quoteTokenProgram],
    ['Pyth feed', market.pythFeedId],
  ];
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied("Copy isn't available in this browser.");
    }
  }
  return (
    <section className="border-t border-line-default pt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-sm text-text-primary underline"
      >
        View technical details
      </button>
      {open ? (
        <div className="mt-5 space-y-3 text-xs">
          <p className="text-text-secondary">
            Displayed share quantity is derived from raw units and the current
            supported multiplier. Raw units are not share quantities.
          </p>
          {entries.map(([label, value]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-3 border-b border-line-subtle pb-3"
            >
              <span className="text-text-tertiary">{label}</span>
              <div className="flex min-w-0 items-center gap-2">
                <code className="truncate font-mono text-text-secondary">
                  {value}
                </code>
                <button
                  type="button"
                  aria-label={`Copy ${label}`}
                  onClick={() => void copy(label, value)}
                  className="text-text-primary underline"
                >
                  Copy
                </button>
              </div>
            </div>
          ))}
          <p aria-live="polite" className="text-text-secondary">
            {copied
              ? copied === "Copy isn't available in this browser."
                ? copied
                : 'Copied'
              : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
