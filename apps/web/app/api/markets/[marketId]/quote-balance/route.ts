import { NextResponse } from 'next/server';
import { getMarket } from '@/server/market-registry';
import { readSpendableQuoteBalance } from '@/server/holdings';

export async function GET(request: Request, context: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await context.params;
  const market = getMarket(marketId);
  const owner = new URL(request.url).searchParams.get('owner');
  if (!market || !owner) return NextResponse.json({ message: "We couldn't read your quote balance." }, { status: 400 });
  try { return NextResponse.json(await readSpendableQuoteBalance(market, owner), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ message: 'Quote balance is temporarily unavailable. Nothing in your wallet changed.' }, { status: 503 }); }
}
