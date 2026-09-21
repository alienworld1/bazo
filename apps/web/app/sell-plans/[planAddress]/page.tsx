import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { readPublicSellPlan } from '@/server/plans';

export const dynamic = 'force-dynamic';

export default async function SellPlanDetailPage({
  params,
}: {
  params: Promise<{ planAddress: string }>;
}) {
  const { planAddress } = await params;
  const plan = await readPublicSellPlan(planAddress);
  if (!plan) notFound();

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl border-y border-line-default py-8">
        <p className="font-mono text-xs text-text-tertiary">SELL PLAN</p>
        <h1 className="mt-3 text-3xl font-medium text-text-primary">
          {plan.status === 'active' ? 'Plan sealed' : 'Sell Plan'}
        </h1>
        <p className="mt-3 text-text-secondary">
          {plan.status === 'active'
            ? 'Your stock is funded and your future Stages are binding.'
            : 'This Plan is available to inspect on Devnet.'}
        </p>
        <dl className="mt-8 space-y-4 text-sm">
          <PlanFact label="Active Stage" value={`Stage ${plan.currentStageIndex + 1}`} />
          <PlanFact label="Remaining" value={`${plan.remainingRawInventory} raw`} />
          <PlanFact label="Total committed" value={`${plan.initialRawInventory} raw`} />
          <PlanFact label="Future path" value="SEALED" />
          <PlanFact label="Created" value={plan.createdAt} />
          <PlanFact label="Plan ends" value={plan.expiresAt} />
        </dl>
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

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line-subtle pb-3">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="break-all font-mono text-text-primary">{value}</dd>
    </div>
  );
}
