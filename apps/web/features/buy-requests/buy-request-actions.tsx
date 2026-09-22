'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cancelBuyRequestInstruction } from '@bazo/sdk';
import { solanaClient } from '@/components/solana-client';

export function BuyRequestActions({ request, buyer, marketId, programAddress, marketAddress, quoteMint, quoteTokenProgram, status }: { request: string; buyer: string; marketId: string; programAddress: string; marketAddress: string; quoteMint: string; quoteTokenProgram: string; status: 'active' | 'canceled' | 'unknown' }) {
  const connected = useConnectedWallet(solanaClient); const router = useRouter(); const [progress, setProgress] = useState<string>(); const [error, setError] = useState<string>();
  if (status !== 'active') return null;
  if (!connected || connected.account.address !== buyer) return <p className="mt-8 text-sm text-text-secondary">Reconnect the wallet that owns this Buy Request to recover unused quote.</p>;
  const cancel = async () => { setError(undefined); setProgress('Preparing cancellation…'); try { const response = await fetch(`/api/markets/${marketId}/quote-balance?owner=${encodeURIComponent(buyer)}`, { cache: 'no-store' }); const balance = await response.json() as { sourceTokenAccount?: string }; if (!response.ok || !balance.sourceTokenAccount) throw new Error(); setProgress('Awaiting approval…'); const instruction = await cancelBuyRequestInstruction({ programAddress: address(programAddress), buyer: address(buyer), market: address(marketAddress), quoteMint: address(quoteMint), quoteTokenProgram: address(quoteTokenProgram), request: address(request), escrow: address((await fetch(`/api/buy-requests/${request}`, { cache: 'no-store' }).then(item => item.json() as Promise<{ escrow: string }>)).escrow), buyerQuoteDestination: address(balance.sourceTokenAccount) }); setProgress('Confirming cancellation…'); await solanaClient.sendTransaction([instruction]); setProgress('Verifying cancellation…'); router.refresh(); } catch { setProgress(undefined); setError("We couldn't cancel this request. Nothing moved."); } };
  return <div className="mt-8"><button type="button" onClick={() => void cancel()} disabled={Boolean(progress)} className="min-h-11 border border-line-default px-4 text-sm text-text-primary">Cancel request</button>{progress ? <p className="mt-3 text-sm text-text-secondary" aria-live="polite">{progress}</p> : null}{error ? <p className="mt-3 text-sm text-warning" role="alert">{error}</p> : null}</div>;
}
