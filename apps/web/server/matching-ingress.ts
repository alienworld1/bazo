import 'server-only';
import { readStorageSession } from './private-storage/auth';

const deliveries = new Map<string, { count: number; resetAt: number }>();

export function allowMatchingDelivery(owner: string, object: string): boolean {
  const key = `${owner}:${object}`;
  const now = Date.now();
  const previous = deliveries.get(key);
  const current =
    !previous || previous.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : previous;
  current.count += 1;
  deliveries.set(key, current);
  return current.count <= 10;
}

export function matchingOwner(request: Request): string | undefined {
  const secret = process.env.BAZO_AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) return undefined;
  const cookie = request.headers
    .get('cookie')
    ?.match(/(?:^|; )bazo_private_session=([^;]+)/)?.[1];
  return readStorageSession(cookie, secret);
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function readOpeningBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new Error('invalid content type');
  const text = await request.text();
  if (text.length > 4_096) throw new Error('opening too large');
  return JSON.parse(text) as unknown;
}

export async function coordinatorRequest(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<Response> {
  const rawUrl = process.env.BAZO_COORDINATOR_URL;
  const secret = process.env.BAZO_COORDINATOR_SECRET;
  if (!rawUrl || !secret || secret.length < 32)
    throw new Error('coordinator unavailable');
  const base = new URL(rawUrl);
  if (
    base.protocol !== 'http:' ||
    (base.hostname !== '127.0.0.1' && base.hostname !== 'localhost') ||
    base.username ||
    base.password ||
    base.pathname !== '/'
  )
    throw new Error('coordinator unavailable');
  return fetch(new URL(path, base), {
    method,
    headers: {
      'x-bazo-coordinator-secret': secret,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(4_000),
  });
}
