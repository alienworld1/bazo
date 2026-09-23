import { NextResponse } from 'next/server';
import { readBatch } from '@/server/batches';

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchAddress: string }> },
) {
  const { batchAddress } = await context.params;
  const batch = await readBatch(batchAddress);
  return NextResponse.json(batch ?? { code: 'batch_not_found' }, {
    status: batch ? 200 : 404,
    headers: { 'Cache-Control': 'no-store' },
  });
}
