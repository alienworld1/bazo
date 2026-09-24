import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { OwnerStagePreview } from '@/features/sell-plans/owner-stage-preview';
import { PlanFact } from '@/features/sell-plans/plan-fact';
import { CurrentStageDelivery } from '@/features/sell-plans/current-stage-delivery';
import { PlanRecoveryPanel } from '@/features/sell-plans/recovery/plan-recovery-panel';
import { readRelevantBatch } from '@/server/batches';
import { readPublicSellPlan } from '@/server/plans';
import { readSaleForPlan } from '@/server/settlements';
import { getEnabledMarkets } from '@/server/market-registry';
import { getEnvironment } from '@/server/env';
import { ClaimPlanProceeds } from '@/features/sell-plans/claim-plan-proceeds';
import { SaleReceipt } from '@/features/sell-plans/sale-receipt';
import { RefreshSaleStatus } from '@/components/refresh-sale-status';
import { WithdrawRemainingStock } from '@/features/sell-plans/withdraw-remaining-stock';
import { readChainUnixTimestamp } from '@/server/buy-requests';

export const dynamic = 'force-dynamic';

export default async function SellPlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ planAddress: string }>;
  searchParams: Promise<{
    reconciliation?: string;
    recovery?: string;
    signature?: string;
  }>;
}) {
  const { planAddress } = await params;
  const { reconciliation, recovery, signature } = await searchParams;
  const plan = await readPublicSellPlan(planAddress);
  if (!plan) notFound();
  const [batch, sale, chainNow] = await Promise.all([
    plan.status === 'active'
      ? readRelevantBatch(plan.market)
      : Promise.resolve(null),
    plan.currentStageIndex > 0
      ? readSaleForPlan(plan.address, plan.currentStageIndex - 1)
      : Promise.resolve(null),
    readChainUnixTimestamp(),
  ]);
  const planIsActive =
    plan.status === 'active' && chainNow < BigInt(plan.expiresAtUnix);
  const stockIsWithdrawable =
    BigInt(plan.remainingRawInventory) > 0n &&
    (plan.status === 'complete' ||
      plan.status === 'expired' ||
      (plan.status === 'active' && !planIsActive));
  const market = getEnabledMarkets().find(
    item =>
      item.stockMint === plan.stockVaultMint &&
      item.quoteMint === plan.proceedsVaultMint,
  );
  const claimable =
    BigInt(plan.accruedQuoteAmount) - BigInt(plan.claimedQuoteAmount);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl border-y border-line-default py-8">
        <p className="font-mono text-xs text-text-tertiary">SELL PLAN</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          {plan.status === 'complete'
            ? 'Plan complete'
            : !planIsActive
              ? 'Plan ended'
              : reconciliation !== 'mismatch'
                ? 'Plan sealed'
                : 'Sell Plan'}
        </h1>
        <p className="mt-3 text-text-secondary">
          {plan.status === 'complete'
            ? 'Every committed Stage has finished. Your unclaimed proceeds remain available.'
            : !planIsActive
              ? 'Your Plan has ended. You can withdraw any remaining stock and claim your proceeds.'
              : reconciliation !== 'mismatch'
                ? 'Your stock is funded and your future Stages are binding.'
                : 'This Plan is available to inspect on Devnet.'}
        </p>
        {reconciliation === 'mismatch' ? (
          <p className="mt-4 text-sm text-warning" role="alert">
            Your transaction was confirmed, but the Plan details don&apos;t
            match this browser&apos;s prepared copy. Your stock remains governed
            by the onchain Plan.
          </p>
        ) : null}
        {recovery === 'restored' ? (
          <div className="mt-4" aria-live="polite">
            <p className="text-sm font-medium text-text-primary">
              Backup restored and verified
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              The private details match the current onchain Plan.
            </p>
          </div>
        ) : null}
        <dl className="mt-8 space-y-4 text-sm">
          {planIsActive ? (
            <PlanFact
              label="Active Stage"
              value={`Stage ${plan.currentStageIndex + 1}`}
            />
          ) : null}
          <PlanFact
            label="Remaining"
            value={`${plan.remainingRawInventory} raw`}
          />
          <PlanFact
            label="Total committed"
            value={`${plan.initialRawInventory} raw`}
          />
          {planIsActive ? (
            <PlanFact label="Future path" value="SEALED" />
          ) : null}
          <PlanFact label="Created" value={plan.createdAt} />
          <PlanFact label="Plan ends" value={plan.expiresAt} />
        </dl>
        {sale ? (
          <SaleReceipt sale={sale} />
        ) : (
          <p className="mt-8 text-sm text-text-secondary">
            No sale has completed for this Stage.
          </p>
        )}
        <div className="mt-4">
          <RefreshSaleStatus />
        </div>
        {market &&
        claimable > 0n &&
        claimable <= BigInt(plan.proceedsVaultRawAmount) ? (
          <ClaimPlanProceeds
            plan={plan.address}
            owner={plan.owner}
            market={plan.market}
            marketId={market.id}
            proceedsVault={plan.proceedsVault}
            programAddress={getEnvironment().BAZO_PROGRAM_ID}
            quoteMint={market.quoteMint}
            quoteTokenProgram={market.quoteTokenProgram}
            quoteSymbol={market.quoteSymbol}
            quoteDecimals={plan.quoteDecimals}
            claimableRawAmount={claimable.toString()}
            claimedRawAmount={plan.claimedQuoteAmount}
          />
        ) : null}
        {market && stockIsWithdrawable ? (
          <WithdrawRemainingStock
            programAddress={getEnvironment().BAZO_PROGRAM_ID}
            plan={plan.address}
            owner={plan.owner}
            market={plan.market}
            stockMint={market.stockMint}
            stockTokenProgram={market.stockTokenProgram}
            stockVault={plan.stockVault}
            rawAmount={plan.remainingRawInventory}
            stockSymbol={market.symbol}
          />
        ) : null}
        {planIsActive ? (
          <OwnerStagePreview plan={plan.address} owner={plan.owner} />
        ) : null}
        {planIsActive ? (
          <PlanRecoveryPanel plan={plan.address} owner={plan.owner} />
        ) : null}
        {planIsActive ? (
          <CurrentStageDelivery
            key={`${plan.currentStageIndex}:${plan.currentCommitment}`}
            plan={plan.address}
            owner={plan.owner}
            stageIndex={plan.currentStageIndex}
            commitment={plan.currentCommitment}
          />
        ) : null}
        {planIsActive ? (
          <section className="mt-8 border-t border-line-default pt-5">
            <h2 className="text-lg font-medium text-text-primary">
              Batch status
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              {batch
                ? batch.status === 'open'
                  ? 'Waiting for compatible demand.'
                  : batch.status === 'locked'
                    ? 'Matching is being checked.'
                    : batch.status === 'settled'
                      ? 'Stage sold.'
                      : 'This Batch ended without a sale. Your Stage remains sealed.'
                : 'Waiting for compatible demand.'}
            </p>
            {batch ? (
              <Link
                href={`/batches/${batch.address}`}
                className="mt-3 inline-flex min-h-11 items-center text-sm text-text-primary underline"
              >
                View Batch
              </Link>
            ) : null}
          </section>
        ) : null}
        <details className="mt-8 border-t border-line-default pt-5 text-sm">
          <summary className="cursor-pointer text-text-primary">
            View technical details
          </summary>
          <dl className="mt-4 space-y-3 font-mono text-xs text-text-secondary">
            <PlanFact label="Plan" value={plan.address} />
            <PlanFact label="Owner" value={plan.owner} />
            <PlanFact label="Market" value={plan.market} />
            <PlanFact label="Stock vault" value={plan.stockVault} />
            <PlanFact label="Proceeds vault" value={plan.proceedsVault} />
            <PlanFact
              label="Current commitment"
              value={plan.currentCommitmentFingerprint}
            />
            {signature ? (
              <PlanFact label="Transaction" value={signature} />
            ) : null}
          </dl>
        </details>
        <div className="mt-8 flex gap-4">
          <Link
            className="min-h-11 text-sm text-text-primary underline"
            href="/portfolio"
          >
            Back to portfolio
          </Link>
          <Link
            className="min-h-11 text-sm text-text-primary underline"
            href="/markets"
          >
            View market
          </Link>
        </div>
      </article>
    </AppShell>
  );
}
