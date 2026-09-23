import {
  hashBuyRequestOpening,
  parseBuyOpening,
  serializeOpening,
} from '@bazo/sdk';
import { NextResponse } from 'next/server';
import { readBuyRequest, readChainUnixTimestamp } from '@/server/buy-requests';
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
  context: { params: Promise<{ requestAddress: string }> },
) {
  const owner = matchingOwner(request);
  if (!owner)
    return NextResponse.json(
      { code: 'connect_owner_wallet' },
      { status: 401, headers },
    );
  const { requestAddress } = await context.params;
  const onchain = await readBuyRequest(requestAddress);
  if (!onchain || onchain.buyer !== owner)
    return NextResponse.json({ code: 'not_found' }, { status: 404, headers });
  try {
    const response = await coordinatorRequest(
      `/v1/openings/request/${requestAddress}`,
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
  context: { params: Promise<{ requestAddress: string }> },
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
    const { requestAddress } = await context.params;
    if (!allowMatchingDelivery(owner, requestAddress))
      return NextResponse.json(
        { code: 'try_again_later' },
        { status: 429, headers },
      );
    const opening = parseBuyOpening(await readOpeningBody(request));
    const [onchain, chainTime] = await Promise.all([
      readBuyRequest(requestAddress),
      readChainUnixTimestamp(),
    ]);
    if (
      !onchain ||
      onchain.buyer !== owner ||
      opening.request !== requestAddress ||
      opening.buyer !== owner ||
      opening.recipient !== onchain.recipient ||
      opening.market !== onchain.market ||
      opening.maxQuoteAmount.toString() !== onchain.maxQuoteAmount ||
      opening.expiresAt.toString() !== onchain.expiresAt ||
      opening.requestNonce.toString() !== onchain.requestNonce ||
      onchain.status !== 'active' ||
      onchain.lockedBatch ||
      BigInt(onchain.expiresAt) <= chainTime
    )
      throw new Error('invalid opening');
    const digest = await hashBuyRequestOpening(opening);
    if (hex(digest) !== onchain.commitmentHex)
      throw new Error('invalid opening');
    let response: Response;
    try {
      response = await coordinatorRequest(
        '/v1/openings/request',
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
      { delivered: true, fingerprint: onchain.commitmentFingerprint },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { code: 'invalid_opening' },
      { status: 400, headers },
    );
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(
    '',
  );
}
