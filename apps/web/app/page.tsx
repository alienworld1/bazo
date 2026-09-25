import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNavigation } from '@/components/landing-navigation';
import { LandingPlanDemo } from '@/components/landing-plan-demo';
import { getEnabledMarkets } from '@/server/market-registry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bazo | Sell tokenized stock in stages',
  description:
    'Plan a series of sales for tokenized stock you own. Bazo matches buyers to your current step while later steps stay hidden until they sell.',
};

export default function Home() {
  const markets = getEnabledMarkets();

  return (
    <>
      <LandingNavigation />
      <main
        id="main-content"
        className="mx-auto max-w-screen-2xl px-4 pb-20 sm:px-6 lg:px-10 xl:px-12"
      >
        <section
          aria-labelledby="hero-title"
          className="border-b border-line-default pt-12 pb-14 sm:pt-16 lg:pt-20"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <div className="max-w-2xl">
              <p className="font-mono text-xs tracking-wider text-text-tertiary">
                FOR TOKENIZED-STOCK HOLDERS ON SOLANA
              </p>
              <h1
                id="hero-title"
                className="mt-6 max-w-xl text-4xl font-semibold leading-[1.06] tracking-tight text-text-primary sm:text-5xl xl:text-[3.375rem]"
              >
                Sell a portion of your stock in stages.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-text-secondary sm:text-lg sm:leading-8">
                Choose how much to sell at each step and the minimum you’ll
                accept relative to the underlying stock price. Bazo matches the
                current step with buyers; later steps stay hidden until they
                sell.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/markets"
                  className="inline-flex min-h-12 items-center justify-center rounded border border-text-primary bg-text-primary px-6 text-sm font-medium text-canvas transition-colors hover:border-text-secondary hover:bg-text-secondary"
                >
                  Open Bazo{' '}
                  <span aria-hidden="true" className="ml-3">
                    ↗
                  </span>
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex min-h-12 items-center justify-center rounded border border-line-strong px-5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2"
                >
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-sm text-text-tertiary">
                Currently available on a Solana Devnet test market.
              </p>
            </div>
            <LandingPlanDemo />
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="how-title"
          className="scroll-mt-8 border-b border-line-default py-16 sm:py-20"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)] lg:gap-16">
            <div>
              <p className="font-mono text-xs tracking-wider text-text-tertiary">
                THE SALE, STEP BY STEP
              </p>
              <h2
                id="how-title"
                className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight text-text-primary sm:text-4xl"
              >
                One plan. Each sale on your terms.
              </h2>
              <p className="mt-5 max-w-md text-base leading-7 text-text-secondary">
                A Sell Plan is a sequence of sales you set in advance for stock
                tokens you already own. You deposit only the portion you want to
                sell.
              </p>
            </div>
            <ol className="border-t border-line-default">
              <li className="grid gap-3 border-b border-line-default py-5 sm:grid-cols-[2.5rem_1fr] sm:gap-5">
                <span className="font-mono text-sm text-active">01</span>
                <div>
                  <h3 className="text-lg font-medium text-text-primary">
                    You choose the sales
                  </h3>
                  <p className="mt-2 max-w-xl leading-7 text-text-secondary">
                    Set an amount and a minimum for each step, measured against
                    the underlying stock’s price. Later steps are committed, but
                    their terms stay out of public view.
                  </p>
                </div>
              </li>
              <li className="grid gap-3 border-b border-line-default py-5 sm:grid-cols-[2.5rem_1fr] sm:gap-5">
                <span className="font-mono text-sm text-active">02</span>
                <div>
                  <h3 className="text-lg font-medium text-text-primary">
                    Buyers set their limits
                  </h3>
                  <p className="mt-2 max-w-xl leading-7 text-text-secondary">
                    Buyers specify how much they want and the most they’ll pay.
                    A sale can happen when buyer demand covers the current step
                    and both sides’ price limits are met.
                  </p>
                </div>
              </li>
              <li className="grid gap-3 border-b border-line-default py-5 sm:grid-cols-[2.5rem_1fr] sm:gap-5">
                <span className="font-mono text-sm text-active">03</span>
                <div>
                  <h3 className="text-lg font-medium text-text-primary">
                    A sale becomes a receipt
                  </h3>
                  <p className="mt-2 max-w-xl leading-7 text-text-secondary">
                    With a valid, verified market reference, the whole current
                    step settles. Its terms become public as a completed sale,
                    and the next step takes its place.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section
          aria-labelledby="difference-title"
          className="border-b border-line-default py-16 sm:py-20"
        >
          <p className="font-mono text-xs tracking-wider text-text-tertiary">
            WHY THIS WORKS DIFFERENTLY
          </p>
          <h2
            id="difference-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-text-primary sm:text-4xl"
          >
            Your future sales don’t need to be a public list of orders.
          </h2>
          <div className="mt-9 grid gap-8 md:grid-cols-2 md:gap-14">
            <div className="border-l-2 border-line-strong pl-5">
              <p className="font-mono text-xs text-text-tertiary">
                VISIBLE SELL ORDERS
              </p>
              <p className="mt-3 max-w-md leading-7 text-text-secondary">
                A series of orders can reveal the prices and amounts you intend
                to sell later.
              </p>
            </div>
            <div className="border-l-2 border-active pl-5">
              <p className="font-mono text-xs text-active">A BAZO SELL PLAN</p>
              <p className="mt-3 max-w-md leading-7 text-text-secondary">
                You commit the sequence upfront. Future sale terms stay hidden
                until each sale completes.
              </p>
            </div>
          </div>
          <div className="mt-11 max-w-3xl border-t border-line-default pt-7">
            <p className="text-xl font-medium text-text-primary">
              What sells stays sold.
            </p>
            <p className="mt-2 leading-7 text-text-secondary">
              Your sale proceeds do not automatically buy the stock back.
              Deposits and completed sales remain visible onchain.
            </p>
          </div>
        </section>

        <section
          id="supported-market"
          aria-labelledby="market-title"
          className="scroll-mt-8 py-16 sm:py-20"
        >
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="font-mono text-xs tracking-wider text-text-tertiary">
                START WITH A SUPPORTED MARKET
              </p>
              <h2
                id="market-title"
                className="mt-4 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl"
              >
                Open Bazo
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-text-secondary">
              Bazo currently supports one configured Solana Devnet test market.
              You’ll need a compatible wallet and test assets to transact.
            </p>
          </div>
          <div className="mt-8 border-y border-line-default">
            {markets.map(market => (
              <div
                key={market.id}
                className="grid gap-5 py-6 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-mono text-xs text-text-tertiary">
                    {market.symbol} / {market.quoteSymbol} · SOLANA DEVNET TEST
                    MARKET
                  </p>
                  <h3 className="mt-2 text-2xl font-medium text-text-primary">
                    {market.displayName}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/markets/${market.id}`}
                    className="inline-flex min-h-11 items-center justify-center rounded border border-line-strong px-5 text-sm text-text-primary transition-colors hover:bg-surface-2"
                  >
                    View market
                  </Link>
                  <Link
                    href={`/buy?market=${market.id}`}
                    className="inline-flex min-h-11 items-center justify-center rounded border border-line-default px-5 text-sm text-text-secondary transition-colors hover:border-line-strong hover:text-text-primary"
                  >
                    Looking to buy?
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/markets"
            className="mt-8 inline-flex min-h-12 items-center justify-center rounded border border-text-primary bg-text-primary px-6 text-sm font-medium text-canvas transition-colors hover:border-text-secondary hover:bg-text-secondary"
          >
            Open Bazo{' '}
            <span aria-hidden="true" className="ml-3">
              ↗
            </span>
          </Link>
        </section>
      </main>
    </>
  );
}
