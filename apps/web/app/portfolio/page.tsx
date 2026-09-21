import { AppShell } from '@/components/app-shell';
import { ReferenceStatus } from '@/components/reference-status';
import { SupportedHolding } from '@/components/supported-holding';
import { toPublicMarket } from '@/lib/markets';
import { getEnabledMarkets } from '@/server/market-registry';

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const market = toPublicMarket(getEnabledMarkets()[0]);
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-xs text-text-tertiary">PORTFOLIO</p>
        <SupportedHolding market={market} />
        <section className="mt-10">
          <h2 className="text-lg font-medium text-text-primary">
            Underlying reference
          </h2>
          <div className="mt-4">
            <ReferenceStatus marketId={market.id} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
