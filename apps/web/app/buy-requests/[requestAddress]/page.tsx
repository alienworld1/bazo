import Link from 'next/link';
import { address } from '@solana/kit';
import { fetchBatchPolicy } from '@bazo/sdk';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { BuyRequestActions } from '@/features/buy-requests/buy-request-actions';
import { BuyRequestPrivateTerms } from '@/features/buy-requests/buy-request-private-terms';
import { BuyRequestDelivery } from '@/features/buy-requests/buy-request-delivery';
import { formatDisplayAmount } from '@/lib/token-amounts';
import { readBuyRequest, readChainUnixTimestamp } from '@/server/buy-requests';
import { getEnvironment } from '@/server/env';
import { getEnabledMarkets } from '@/server/market-registry';
import { readSpendableQuoteBalance } from '@/server/holdings';
import { readBatch, readCurrentOpenBatch } from '@/server/batches';
import { RefreshSaleStatus } from '@/components/refresh-sale-status';

export const dynamic = 'force-dynamic';

export default async function BuyRequestPage({
  params,
}: {
  params: Promise<{ requestAddress: string }>;
}) {
  const { requestAddress } = await params;
  const request = await readBuyRequest(requestAddress);
  if (!request) notFound();
  const market = getEnabledMarkets().find(
    item => item.quoteMint === request.escrowMint,
  );
  if (!market) notFound();

  const env = getEnvironment();
  const [chainTime, quoteBalance, batchPolicy] = await Promise.all([
    readChainUnixTimestamp(),
    readSpendableQuoteBalance(market, request.buyer),
    fetchBatchPolicy({
      rpcUrl: env.SOLANA_RPC_URL,
      programAddress: address(env.BAZO_PROGRAM_ID),
      market: address(request.market),
    }),
  ]);
  if (!batchPolicy) throw new Error('Batch policy unavailable');
  const batch = request.lockedBatch
    ? await readBatch(request.lockedBatch)
    : await readCurrentOpenBatch(request.market);
  const expired =
    request.status === 'active' && BigInt(request.expiresAt) <= chainTime;
  const batchDuration = BigInt(batchPolicy.windowSeconds);
  const firstWindowEnd =
    (BigInt(request.createdAt) / batchDuration + 1n) * batchDuration;
  const matchingWindowOpen = chainTime < firstWindowEnd;
  const title =
    request.status === 'canceled'
      ? 'Request canceled'
      : request.status === 'filled'
        ? 'Stock delivered'
        : request.status === 'closed'
          ? 'Stock delivered · quote returned'
          : request.status === 'expired'
            ? 'Refund returned'
            : expired
              ? 'Refund available'
              : request.lockedBatch
                ? 'Locked'
                : 'Request funded';
  const facts = [
    ['Private terms', 'Sealed'],
    [
      'Quote in escrow',
      `${formatDisplayAmount(request.escrowRawAmount, quoteBalance.decimals)} ${market.quoteSymbol}`,
    ],
    [
      'Quote spent',
      `${formatDisplayAmount(request.spentQuoteAmount, quoteBalance.decimals)} ${market.quoteSymbol}`,
    ],
    [
      'Unused quote',
      `${formatDisplayAmount(request.escrowRawAmount, quoteBalance.decimals)} ${market.quoteSymbol}`,
    ],
    [
      'Request expires',
      new Date(Number(request.expiresAt) * 1_000).toLocaleString(),
    ],
  ];
  const evidence = [
    ['Escrow raw amount', request.escrowRawAmount],
    ['Spent raw amount', request.spentQuoteAmount],
    ['Refundable raw amount', request.refundableQuoteAmount],
    ['Stock recipient', request.recipient],
    ['Commitment fingerprint', request.commitmentFingerprint],
    ['Buyer', request.buyer],
    ['Market', request.market],
    ['Quote mint', market.quoteMint],
    ['Quote token program', market.quoteTokenProgram],
    ['Created slot', request.createdSlot],
    ['Request nonce', request.requestNonce],
    ['Batch lock', request.lockedBatch ?? 'None'],
    ['Request address', request.address],
    ['Escrow address', request.escrow],
  ];

  return (
    <AppShell>
      <section className="mx-auto max-w-3xl">
        <p className="font-mono text-xs text-text-tertiary">BUY REQUEST</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">{title}</h1>
        <p className="mt-3 text-text-secondary">
          {request.status === 'filled'
            ? 'Your stock was delivered to the recipient. Any unused quote is ready to return.'
            : request.status === 'closed'
              ? 'Your stock was delivered and unused quote was returned.'
              : request.status === 'active' && !expired
                ? request.lockedBatch
                  ? 'This request is reserved for its Batch. Unused quote can be returned once the lock resolves.'
                  : 'Your quote is held onchain. You can cancel this request to return the unused amount.'
                : expired
                  ? 'This request has expired. Unused quote can be returned to your wallet.'
                  : 'This request cannot enter matching.'}
        </p>
        <dl className="mt-8 space-y-4 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="border-b border-line-subtle pb-3">
              <dt className="text-text-tertiary">{label}</dt>
              <dd className="mt-1 break-all font-mono text-text-primary">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <BuyRequestPrivateTerms
          request={request}
          marketId={market.id}
          stockDecimals={market.tokenDecimals}
          symbol={market.symbol}
        />
        <BuyRequestDelivery
          key={request.commitmentHex}
          request={request}
          matchingWindowOpen={matchingWindowOpen}
        />
        {request.status === 'active' &&
        !matchingWindowOpen &&
        !request.lockedBatch ? (
          <p className="mt-6 text-sm text-text-secondary">
            This request&apos;s Batch window has passed. It won&apos;t enter
            another Batch; you can cancel it to return unused quote.
          </p>
        ) : null}
        {batch ? (
          <section className="mt-8 border-t border-line-default pt-5">
            <p
              className={`text-sm ${request.lockedBatch ? 'text-locked' : 'text-text-secondary'}`}
            >
              {request.lockedBatch
                ? `You can cancel after ${new Date(Number(batch.lockDeadline) * 1_000).toLocaleString()} once the Batch is released.`
                : 'This Market has a Batch collecting requests.'}
            </p>
            <Link
              href={`/batches/${batch.address}`}
              className="mt-3 inline-flex min-h-11 items-center text-sm text-text-primary underline"
            >
              View Batch
            </Link>
          </section>
        ) : null}
        {request.status === 'active' && !expired ? (
          <p className="mt-8 text-sm text-text-secondary">
            Your request remains governed by its onchain escrow.
          </p>
        ) : null}
        <BuyRequestActions
          request={request}
          escrowRawAmount={request.escrowRawAmount}
          programAddress={getEnvironment().BAZO_PROGRAM_ID}
          quoteMint={market.quoteMint}
          quoteTokenProgram={market.quoteTokenProgram}
          quoteSymbol={market.quoteSymbol}
          quoteDecimals={quoteBalance.decimals}
          expired={expired}
        />
        <div className="mt-4">
          <RefreshSaleStatus />
        </div>
        <details className="mt-8 border-t border-line-default pt-5 text-sm">
          <summary className="min-h-11 cursor-pointer py-3 text-text-primary">
            View technical details
          </summary>
          <dl className="mt-3 space-y-3 break-all font-mono text-xs text-text-secondary">
            {evidence.map(([label, value]) => (
              <div key={label}>
                <dt className="text-text-tertiary">{label}</dt>
                <dd className="mt-1">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
        <Link
          href={`/markets/${market.id}`}
          className="mt-6 inline-flex min-h-11 items-center border border-line-default px-4 text-sm text-text-primary"
        >
          Back to Market
        </Link>
      </section>
    </AppShell>
  );
}
