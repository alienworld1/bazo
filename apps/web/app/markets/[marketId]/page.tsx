import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ReferenceStatus } from '@/components/reference-status';
import { SupportedHolding } from '@/components/supported-holding';
import { TechnicalInspector } from '@/components/technical-inspector';
import { toPublicMarket } from '@/lib/markets';
import { getMarket } from '@/server/market-registry';

export const dynamic = 'force-dynamic';

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;
  const configuredMarket = getMarket(marketId);
  if (!configuredMarket) notFound();
  const market = toPublicMarket(configuredMarket);

  return (
    <AppShell>
      <article className="mx-auto max-w-5xl">
        <p className="font-mono text-xs text-text-tertiary">
          {market.symbol} / {market.quoteSymbol}
        </p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          {market.displayName}
        </h1>
        <p className="mt-3 text-sm text-text-secondary">Devnet test asset</p>
        <section className="mt-10 grid gap-10 border-y border-line-default py-8 md:grid-cols-2">
          <div>
            <h2 className="text-sm font-medium text-text-primary">
              Underlying reference
            </h2>
            <div className="mt-4">
              <ReferenceStatus marketId={market.id} />
            </div>
          </div>
          <SupportedHolding market={market} />
        </section>
        <div className="mt-10">
          <TechnicalInspector market={market} />
        </div>
      </article>
    </AppShell>
  );
}
