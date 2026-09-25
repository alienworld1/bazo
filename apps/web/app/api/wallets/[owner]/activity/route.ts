import { isAddress } from '@solana/kit';
import { NextResponse } from 'next/server';
import { readWalletActivity } from '@/server/wallet-activity';

export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string }> },
) {
  const { owner } = await context.params;
  if (!isAddress(owner))
    return NextResponse.json(
      { message: 'Invalid wallet address.' },
      { status: 400 },
    );
  try {
    return NextResponse.json(await readWalletActivity(owner), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { message: "We couldn't load the latest activity. Try again." },
      { status: 503 },
    );
  }
}
