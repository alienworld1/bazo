import Link from 'next/link';
import { AppShell } from '@/components/app-shell';

export default function Home() {
  return (
    <AppShell>
      <section className="mx-auto max-w-5xl py-14 sm:py-24">
        <p className="font-mono text-xs text-text-tertiary">DEVNET MARKET</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-medium tracking-tight text-text-primary sm:text-6xl">
          Bazo turns sealed stock sell plans into one-way onchain liquidity.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-text-secondary">
          Commit a future sell path without publishing every step before it
          executes.
        </p>
        <Link
          href="/portfolio"
          className="mt-10 inline-flex min-h-11 items-center rounded border border-line-strong px-5 text-sm text-text-primary hover:bg-surface-2"
        >
          Open Bazo
        </Link>
      </section>
      <section className="mx-auto max-w-5xl border-y border-line-default py-8">
        <p className="font-mono text-xs text-text-tertiary">
          SEALED → ACTIVE → SOLD
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <p className="border-l-2 border-line-strong pl-3 text-text-secondary">
            Choose a future sell path.
          </p>
          <p className="border-l-2 border-line-strong pl-3 text-text-secondary">
            Keep future steps sealed until they execute.
          </p>
          <p className="border-l-2 border-line-strong pl-3 text-text-secondary">
            Stock can become quote proceeds.
          </p>
        </div>
        <p className="mt-7 text-sm text-text-secondary">
          A Sell Plan never buys the stock back.
        </p>
      </section>
    </AppShell>
  );
}
