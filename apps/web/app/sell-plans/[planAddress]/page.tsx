import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { OwnerStagePreview } from '@/features/sell-plans/owner-stage-preview';
import { PlanFact } from '@/features/sell-plans/plan-fact';
import { readPublicSellPlan } from '@/server/plans';

export const dynamic = 'force-dynamic';

export default async function SellPlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ planAddress: string }>;
  searchParams: Promise<{ reconciliation?: string; signature?: string }>;
}) {
  const { planAddress } = await params;
  const { reconciliation, signature } = await searchParams;
  const plan = await readPublicSellPlan(planAddress);
  if (!plan) notFound();

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl border-y border-line-default py-8">
        <p className="font-mono text-xs text-text-tertiary">SELL PLAN</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          {plan.status === 'active' && reconciliation !== 'mismatch'
            ? 'Plan sealed'
            : 'Sell Plan'}
        </h1>
        <p className="mt-3 text-text-secondary">
          {plan.status === 'active' && reconciliation !== 'mismatch'
            ? 'Your stock is funded and your future Stages are binding.'
            : 'This Plan is available to inspect on Devnet.'}
        </p>
        {reconciliation === 'mismatch' ? (
          <p className="mt-4 text-sm text-warning" role="alert">
            Your transaction was confirmed, but the Plan details don&apos;t match
            this browser&apos;s prepared copy. Your stock remains governed by the
            onchain Plan.
          </p>
        ) : null}
        <dl className="mt-8 space-y-4 text-sm">
          <PlanFact label="Active Stage" value={`Stage ${plan.currentStageIndex + 1}`} />
          <PlanFact label="Remaining" value={`${plan.remainingRawInventory} raw`} />
          <PlanFact label="Total committed" value={`${plan.initialRawInventory} raw`} />
          <PlanFact label="Future path" value="SEALED" />
          <PlanFact label="Created" value={plan.createdAt} />
          <PlanFact label="Plan ends" value={plan.expiresAt} />
        </dl>
        <OwnerStagePreview plan={plan.address} owner={plan.owner} />
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
            <PlanFact label="Current commitment" value={plan.currentCommitmentFingerprint} />
            {signature ? <PlanFact label="Transaction" value={signature} /> : null}
          </dl>
        </details>
        <div className="mt-8 flex gap-4">
          <Link className="min-h-11 text-sm text-text-primary underline" href="/portfolio">
            Back to portfolio
          </Link>
          <Link className="min-h-11 text-sm text-text-primary underline" href="/markets">
            View market
          </Link>
        </div>
      </article>
    </AppShell>
  );
}
