import { hashCanonicalStage, toHex } from '@bazo/plan-crypto';
import { parseStageOpening, serializeOpening } from '@bazo/sdk';
import { NextResponse } from 'next/server';
import { readPublicSellPlan } from '@/server/plans';
import {
  allowMatchingDelivery,
  coordinatorRequest,
  matchingOwner,
  readOpeningBody,
  sameOrigin,
} from '@/server/matching-ingress';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(
  request: Request,
  context: { params: Promise<{ planAddress: string }> },
) {
  const owner = matchingOwner(request);
  if (!owner)
    return NextResponse.json(
      { code: 'connect_owner_wallet' },
      { status: 401, headers },
    );
  const { planAddress } = await context.params;
  const plan = await readPublicSellPlan(planAddress);
  if (!plan || plan.owner !== owner)
    return NextResponse.json({ code: 'not_found' }, { status: 404, headers });
  try {
    const response = await coordinatorRequest(
      `/v1/openings/plan/${planAddress}`,
      'GET',
    );
    if (!response.ok) throw new Error('unavailable');
    return NextResponse.json(await response.json(), { headers });
  } catch {
    return NextResponse.json(
      { code: 'delivery_unavailable' },
      { status: 503, headers },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ planAddress: string }> },
) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { code: 'delivery_denied' },
      { status: 403, headers },
    );
  const owner = matchingOwner(request);
  if (!owner)
    return NextResponse.json(
      { code: 'connect_owner_wallet' },
      { status: 401, headers },
    );
  try {
    const { planAddress } = await context.params;
    if (!allowMatchingDelivery(owner, planAddress))
      return NextResponse.json(
        { code: 'try_again_later' },
        { status: 429, headers },
      );
    const opening = parseStageOpening(await readOpeningBody(request));
    const plan = await readPublicSellPlan(planAddress);
    if (
      !plan ||
      plan.owner !== owner ||
      plan.status !== 'active' ||
      plan.address !== opening.plan ||
      plan.market !== opening.market ||
      plan.currentStageIndex !== opening.stageIndex ||
      opening.rawQuantity > BigInt(plan.remainingRawInventory) ||
      plan.stockVaultRawAmount !== plan.remainingRawInventory
    )
      throw new Error('invalid opening');
    const digest = await hashCanonicalStage(opening);
    if (toHex(digest) !== plan.currentCommitment)
      throw new Error('invalid opening');
    let response: Response;
    try {
      response = await coordinatorRequest(
        '/v1/openings/plan',
        'POST',
        serializeOpening(opening),
      );
    } catch {
      return NextResponse.json(
        { code: 'delivery_unavailable' },
        { status: 503, headers },
      );
    }
    if (response.status === 409)
      return NextResponse.json(
        { code: 'opening_conflict' },
        { status: 409, headers },
      );
    if (!response.ok)
      return NextResponse.json(
        { code: 'delivery_unavailable' },
        { status: 503, headers },
      );
    return NextResponse.json(
      { delivered: true, fingerprint: plan.currentCommitmentFingerprint },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { code: 'invalid_opening' },
      { status: 400, headers },
    );
  }
}
