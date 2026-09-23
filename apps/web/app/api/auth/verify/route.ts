import { NextResponse } from 'next/server';
import { verifyStorageChallenge } from '@/server/private-storage/auth';
import { privateStorageConfig } from '@/server/private-storage/config';

export async function POST(request: Request) {
  const config = privateStorageConfig();
  if (!config || !sameOrigin(request))
    return NextResponse.json(
      { code: 'authentication_failed' },
      { status: 401, headers: noStore },
    );
  try {
    const body = await readJson(request);
    if (
      typeof body.challengeId !== 'string' ||
      typeof body.owner !== 'string' ||
      typeof body.signature !== 'string'
    )
      throw new Error();
    const session = verifyStorageChallenge(
      body.challengeId,
      body.owner,
      body.signature,
      config.secret,
    );
    if (!session)
      return NextResponse.json(
        { code: 'authentication_failed' },
        { status: 401, headers: noStore },
      );
    const response = NextResponse.json(
      { authenticated: true, expiresAt: session.expiresAt },
      { headers: noStore },
    );
    response.cookies.set('bazo_private_session', session.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api',
      maxAge: session.maxAge,
    });
    return response;
  } catch {
    return NextResponse.json(
      { code: 'authentication_failed' },
      { status: 401, headers: noStore },
    );
  }
}

const noStore = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new Error();
  const text = await request.text();
  if (text.length > 12 * 1024) throw new Error();
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
}
