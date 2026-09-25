import { ReferenceStatus } from '@/components/reference-status';
import type { ConfirmedSale } from '@/server/settlements';
import { SaleReceipt } from './sale-receipt';

type StageResult = {
  stageIndex: number;
  sale: ConfirmedSale | null;
  unavailable: boolean;
};

export function PlanStageSequence({
  stages,
  currentStageIndex,
  active,
  marketId,
}: {
  stages: StageResult[];
  currentStageIndex: number;
  active: boolean;
  marketId?: string;
}) {
  return (
    <section className="mt-10" aria-label="Sell Plan stages">
      <h2 className="text-xl font-medium text-text-primary">Stage sequence</h2>
      <ol className="mt-5 space-y-4 border-l-2 border-line-default pl-5">
        {stages.map(stage => (
          <li
            id={`sale-${stage.stageIndex}`}
            key={stage.stageIndex}
            className="relative before:absolute before:-left-[1.65rem] before:top-5 before:size-3 before:rounded-full before:border before:border-line-strong before:bg-surface-1"
          >
            {stage.sale ? (
              <SaleReceipt sale={stage.sale} />
            ) : (
              <div className="border border-warning p-4">
                <p className="font-medium text-warning">
                  Stage {stage.stageIndex + 1} · receipt unavailable
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  We couldn&apos;t verify this sale yet. Refresh to check again.
                </p>
              </div>
            )}
          </li>
        ))}
        {active ? (
          <li className="relative before:absolute before:-left-[1.65rem] before:top-6 before:size-3 before:rounded-full before:border before:border-info before:bg-info">
            <div className="min-h-44 border border-line-strong bg-surface-2 p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-info">
                Current Stage · {currentStageIndex + 1}
              </p>
              <p className="mt-3 text-lg font-medium text-text-primary">
                Your next sale remains sealed until matching and a valid
                reference allow settlement.
              </p>
              {marketId ? (
                <div className="mt-5">
                  <ReferenceStatus marketId={marketId} />
                </div>
              ) : null}
            </div>
          </li>
        ) : null}
        {active ? (
          <li className="relative before:absolute before:-left-[1.65rem] before:top-5 before:size-3 before:rounded-full before:border before:border-locked before:bg-surface-1">
            <div className="min-h-24 border border-line-default p-5">
              <p className="font-medium text-locked">Future path · Sealed</p>
              <p className="mt-2 text-sm text-text-secondary">
                Future Stage details are sealed.
              </p>
            </div>
          </li>
        ) : null}
      </ol>
    </section>
  );
}
