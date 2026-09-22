import { isAddress } from '@solana/kit';
import { NextResponse } from 'next/server';
import { createStorageChallenge } from '@/server/private-storage/auth';
import { privateStorageConfig } from '@/server/private-storage/config';

export async function POST(request: Request) {
  const config = privateStorageConfig();
  if (!config || !sameOrigin(request)) return unavailable();
  try {
    const body = await readJson(request);
    if (body.purpose !== 'private-plan-storage' || typeof body.owner !== 'string' || !isAddress(body.owner)) return NextResponse.json({ code: 'invalid_request' }, { status: 400 });
    return NextResponse.json(createStorageChallenge(body.owner, new URL(request.url).origin), { headers: noStore });
  } catch { return NextResponse.json({ code: 'invalid_request' }, { status: 400 }); }
}

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function unavailable() { return NextResponse.json({ code: 'private_storage_unavailable' }, { status: 503, headers: noStore }); }
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }
async function readJson(request: Request): Promise<Record<string, unknown>> { if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error(); const text = await request.text(); if (text.length > 4096) throw new Error(); const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
