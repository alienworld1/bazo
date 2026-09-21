import { AppShell } from '@/components/app-shell';
import { MarketRow } from '@/components/market-row';
import { toPublicMarket } from '@/lib/markets';
import { getEnabledMarkets } from '@/server/market-registry';

export const dynamic = 'force-dynamic';

export default function MarketsPage() {
  const markets = getEnabledMarkets().map(toPublicMarket);
  return (
    <AppShell>
      <section className="mx-auto max-w-5xl">
        <p className="font-mono text-xs text-text-tertiary">MARKETS</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          Supported Market
        </h1>
        <div className="mt-8">
          {markets.map(market => (
            <MarketRow key={market.id} market={market} />
          ))}
        </div>
      </section>
    </AppShell>
  );
}
