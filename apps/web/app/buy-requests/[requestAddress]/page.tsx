import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { BuyRequestActions } from '@/features/buy-requests/buy-request-actions';
import { BuyRequestPrivateTerms } from '@/features/buy-requests/buy-request-private-terms';
import { formatDisplayAmount } from '@/lib/token-amounts';
import { readBuyRequest, readChainUnixTimestamp } from '@/server/buy-requests';
import { getEnvironment } from '@/server/env';
import { getEnabledMarkets } from '@/server/market-registry';
import { readSpendableQuoteBalance } from '@/server/holdings';

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

  const [chainTime, quoteBalance] = await Promise.all([
    readChainUnixTimestamp(),
    readSpendableQuoteBalance(market, request.buyer),
  ]);
  const expired =
    request.status === 'active' && BigInt(request.expiresAt) <= chainTime;
  const title =
    request.status === 'canceled'
      ? 'Request canceled'
      : request.status === 'expired'
        ? 'Refund returned'
        : expired
          ? 'Refund available'
          : 'Sealed in next Batch';
  const facts = [
    ['Private terms', 'Sealed'],
    [
      'Quote in escrow',
      `${formatDisplayAmount(request.escrowRawAmount, quoteBalance.decimals)} ${market.quoteSymbol} (${request.escrowRawAmount} raw)`,
    ],
    ['Quote spent', `${request.spentQuoteAmount} raw`],
    ['Quote refundable', `${request.refundableQuoteAmount} raw`],
    [
      'Request expires',
      new Date(Number(request.expiresAt) * 1_000).toLocaleString(),
    ],
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
          {request.status === 'active' && !expired
            ? 'Your quote funds are locked onchain. Matching needs your private details before this request can participate.'
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
        {request.status === 'active' && !expired ? (
          <p className="mt-8 text-sm text-text-secondary">
            Matching details need attention until a coordinator ingress is
            configured. Your request remains governed by its onchain escrow.
          </p>
        ) : null}
        <BuyRequestActions
          request={request}
          escrowRawAmount={request.escrowRawAmount}
          marketId={market.id}
          programAddress={getEnvironment().BAZO_PROGRAM_ID}
          quoteMint={market.quoteMint}
          quoteTokenProgram={market.quoteTokenProgram}
          expired={expired}
        />
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
