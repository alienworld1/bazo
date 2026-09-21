import { NextResponse } from 'next/server';
import { readPublicSellPlan } from '@/server/plans';

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
  return NextResponse.json(plan, { headers: { 'Cache-Control': 'no-store' } });
}
