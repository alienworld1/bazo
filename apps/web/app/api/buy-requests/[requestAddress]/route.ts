import { NextResponse } from 'next/server';
import { readBuyRequest } from '@/server/buy-requests';
export async function GET(_request: Request, context: { params: Promise<{ requestAddress: string }> }) { const { requestAddress } = await context.params; const value = await readBuyRequest(requestAddress); return value ? NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ message: "We couldn't find that Buy Request." }, { status: 404 }); }
