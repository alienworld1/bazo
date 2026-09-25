import { AppShell } from '@/components/app-shell';
import { ReferenceStatus } from '@/components/reference-status';
import { SupportedHolding } from '@/components/supported-holding';
import { toPublicMarket } from '@/lib/markets';
import { getEnabledMarkets } from '@/server/market-registry';
import { WalletPositions } from '@/features/portfolio/wallet-positions';
import { WalletActivity } from '@/features/portfolio/wallet-activity';

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const markets = getEnabledMarkets().map(toPublicMarket);
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-xs text-text-tertiary">PORTFOLIO</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          Your positions
        </h1>
        {markets.map(market => (
          <section key={market.id} className="mt-8">
            <SupportedHolding market={market} />
            <div className="mt-5">
              <ReferenceStatus marketId={market.id} />
            </div>
          </section>
        ))}
        <WalletPositions markets={markets} />
        <section className="mt-12">
          <h2 className="text-xl font-medium text-text-primary">
            Recent activity
          </h2>
          <WalletActivity limit={3} />
        </section>
      </div>
    </AppShell>
  );
}
