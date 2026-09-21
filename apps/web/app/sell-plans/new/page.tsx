import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SellPlanComposer } from '@/features/sell-plans/sell-plan-composer';
import type { SellPlanMarket } from '@/features/sell-plans/sell-plan-types';
import { getEnvironment } from '@/server/env';
import { getEnabledMarkets, getMarket } from '@/server/market-registry';

export const dynamic = 'force-dynamic';

export default async function NewSellPlanPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const { market: marketId } = await searchParams;
  const configuredMarket = marketId
    ? getMarket(marketId)
    : getEnabledMarkets()[0];
  if (!configuredMarket) redirect('/markets');
  const market: SellPlanMarket = configuredMarket;
  return <AppShell><SellPlanComposer market={market} programAddress={getEnvironment().BAZO_PROGRAM_ID} /></AppShell>;
}
