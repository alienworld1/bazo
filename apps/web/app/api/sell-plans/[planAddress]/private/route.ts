import { NextResponse } from 'next/server';
import { parsePrivatePlanBlobRecord, type PrivatePlanBlobRecordV1 } from '@bazo/plan-crypto';
import { LocalPrivatePlanBlobAdapter } from '@/server/private-storage/blob-adapter';
import { readStorageSession } from '@/server/private-storage/auth';
import { privateStorageConfig } from '@/server/private-storage/config';
import { readPublicSellPlan } from '@/server/plans';

export async function GET(request: Request, context: { params: Promise<{ planAddress: string }> }) {
  const access = await ownerAccess(request, context);
  if (!access) return hiddenNotFound();
  const record = await new LocalPrivatePlanBlobAdapter(access.config.directory).get(access.owner, access.plan.address);
  if (!record) return hiddenNotFound();
  return NextResponse.json(record, { headers: { ...noStore, ETag: record.ciphertextHash } });
}

export async function PUT(request: Request, context: { params: Promise<{ planAddress: string }> }) {
  if (!sameOrigin(request)) return hiddenNotFound();
  const access = await ownerAccess(request, context);
  if (!access) return hiddenNotFound();
  try {
    const text = await request.text();
    if (text.length > 256 * 1024) throw new Error();
    const record = parsePrivatePlanBlobRecord(text);
    if (record.plan !== access.plan.address || record.owner !== access.owner || record.payload.market !== access.plan.market) throw new Error();
    const result = await new LocalPrivatePlanBlobAdapter(access.config.directory).put(withServerTimestamps(record), request.headers.get('if-match')?.replaceAll('"', ''));
    if (result.kind === 'conflict') return NextResponse.json({ code: 'private_copy_conflict' }, { status: 409, headers: noStore });
    return NextResponse.json({ plan: result.record.plan, ciphertextHash: result.record.ciphertextHash, updatedAt: result.record.updatedAt }, { headers: { ...noStore, ETag: result.record.ciphertextHash } });
  } catch { return NextResponse.json({ code: 'invalid_private_copy' }, { status: 400, headers: noStore }); }
}

async function ownerAccess(request: Request, context: { params: Promise<{ planAddress: string }> }) {
  const config = privateStorageConfig(); if (!config) return undefined;
  const owner = readStorageSession(request.headers.get('cookie')?.match(/(?:^|; )bazo_private_session=([^;]+)/)?.[1], config.secret); if (!owner) return undefined;
  const { planAddress } = await context.params; const plan = await readPublicSellPlan(planAddress);
  return plan?.owner === owner ? { config, owner, plan } : undefined;
}

function withServerTimestamps(record: PrivatePlanBlobRecordV1): PrivatePlanBlobRecordV1 { const now = new Date().toISOString(); return { ...record, createdAt: record.createdAt || now, updatedAt: now }; }
function hiddenNotFound() { return NextResponse.json({ code: 'private_copy_not_found' }, { status: 404, headers: noStore }); }
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }
const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
