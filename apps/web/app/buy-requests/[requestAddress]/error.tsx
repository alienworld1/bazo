'use client';

import { AppShell } from '@/components/app-shell';

export default function BuyRequestUnavailable({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <AppShell>
      <section className="mx-auto max-w-3xl border-y border-line-default py-8">
        <h1 className="text-2xl font-medium text-text-primary">
          Request details are temporarily unavailable
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Your funds remain governed by the onchain request. Try again when
          Devnet responds.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-11 border border-line-strong px-4 text-sm text-text-primary"
        >
          Retry
        </button>
      </section>
    </AppShell>
  );
}
