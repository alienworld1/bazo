import { NextResponse } from 'next/server';
import { getMarket } from '@/server/market-registry';
import { readSupportedHolding } from '@/server/holdings';

export async function GET(
  request: Request,
  context: { params: Promise<{ marketId: string }> },
) {
  const { marketId } = await context.params;
  const market = getMarket(marketId);
  if (!market) {
    return NextResponse.json(
      { code: 'market_not_found', message: "We couldn't find that Market." },
      { status: 404 },
    );
  }
  const owner = new URL(request.url).searchParams.get('owner');
  if (!owner) {
    return NextResponse.json(
      {
        code: 'invalid_owner',
        message: "We couldn't read holdings for this wallet.",
      },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await readSupportedHolding(market, owner), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'unsupported_mint_extension'
        ? "This stock uses token behavior Bazo doesn't support yet."
        : 'Holdings are temporarily unavailable. Nothing in your wallet changed.';
    return NextResponse.json(
      { code: 'holding_unavailable', message },
      { status: 503 },
    );
  }
}
