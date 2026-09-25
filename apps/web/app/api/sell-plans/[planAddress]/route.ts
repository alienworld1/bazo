import { NextResponse } from 'next/server';
import { readPublicSellPlan } from '@/server/plans';
import { getEnabledMarkets } from '@/server/market-registry';
import { readStockMultiplier } from '@/server/holdings';

export async function GET(
  _request: Request,
  context: { params: Promise<{ planAddress: string }> },
) {
  const { planAddress } = await context.params;
  const plan = await readPublicSellPlan(planAddress);
  if (!plan) {
    return NextResponse.json(
      { code: 'plan_not_found', message: "We couldn't find that Sell Plan." },
      { status: 404 },
    );
  }
  const market = getEnabledMarkets().find(
    item =>
      item.stockMint === plan.stockVaultMint &&
      item.quoteMint === plan.proceedsVaultMint,
  );
  if (!market)
    return NextResponse.json(
      { message: "We couldn't verify this Market right now." },
      { status: 503 },
    );
  try {
    const stockMultiplier = await readStockMultiplier(market);
    return NextResponse.json(
      { ...plan, stockMultiplier },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { message: "We couldn't confirm the displayed share amount. Try again." },
      { status: 503 },
    );
  }
}
