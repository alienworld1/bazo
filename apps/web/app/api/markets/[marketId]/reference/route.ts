import { NextResponse } from 'next/server';
import { getMarket } from '@/server/market-registry';
import { readReference } from '@/server/pyth';

export async function GET(
  _request: Request,
  context: { params: Promise<{ marketId: string }> },
) {
  const { marketId } = await context.params;
  const market = getMarket(marketId);
  if (!market)
    return NextResponse.json(
      { code: 'market_not_found', message: "We couldn't find that Market." },
      { status: 404 },
    );
  try {
    return NextResponse.json(await readReference(market), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      {
        code: 'reference_unavailable',
        message:
          "Underlying reference temporarily unavailable. Market availability can't be confirmed.",
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' },
      },
    );
  }
}
