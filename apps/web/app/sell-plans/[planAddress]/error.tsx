'use client';

import Link from 'next/link';

export default function SellPlanError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16" role="alert">
      <h1 className="text-2xl font-medium text-text-primary">
        We couldn&apos;t check this Sell Plan
      </h1>
      <p className="mt-3 text-text-secondary">
        Your Plan may still be available. Try reading it again.
      </p>
      <button
        onClick={reset}
        className="mt-6 min-h-11 rounded border border-line-strong px-4 text-text-primary"
      >
        Retry
      </button>
      <Link
        href="/portfolio"
        className="ml-5 inline-flex min-h-11 items-center text-text-primary underline"
      >
        Back to portfolio
      </Link>
    </main>
  );
}
