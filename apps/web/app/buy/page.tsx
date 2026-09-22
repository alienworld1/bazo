import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { BuyRequestComposer } from '@/features/buy-requests/buy-request-composer';
import { getEnvironment } from '@/server/env';
import { getEnabledMarkets, getMarket } from '@/server/market-registry';

export const dynamic = 'force-dynamic';

export default async function BuyPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const { market: marketId } = await searchParams;
  const market = marketId ? getMarket(marketId) : getEnabledMarkets()[0];
  if (!market) redirect('/markets');
  return <AppShell><BuyRequestComposer market={market} programAddress={getEnvironment().BAZO_PROGRAM_ID} /></AppShell>;
}
