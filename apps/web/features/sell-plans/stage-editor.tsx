'use client';

import type { MarketSession } from '@/lib/markets';
import type { DraftStage, SellPlanMarket } from './sell-plan-types';

const sessionLabels: Record<MarketSession, string> = {
  regular: 'Regular',
  preMarket: 'Pre-market',
  postMarket: 'Post-market',
  overNight: 'Overnight',
};

export function StageEditor({
  market,
  stage,
  onChange,
}: {
  market: SellPlanMarket;
  stage: DraftStage;
  onChange: (stage: DraftStage) => void;
}) {
  return (
    <aside className="border-t border-line-default pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <h2 className="text-sm font-medium text-text-primary">Edit Stage</h2>
      <label className="mt-6 block text-sm text-text-secondary" htmlFor="allocation">
        Allocation
      </label>
      <div className="mt-2 flex items-center border border-line-default bg-surface-1">
        <input
          id="allocation"
          inputMode="decimal"
          value={(stage.allocationBps / 100).toFixed(2)}
          onChange={event => {
            const parsed = parsePercentage(event.target.value);
            if (parsed !== undefined) onChange({ ...stage, allocationBps: parsed });
          }}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-text-primary outline-none"
          aria-describedby="allocation-help"
        />
        <span className="px-3 text-sm text-text-tertiary">%</span>
      </div>
      <p id="allocation-help" className="mt-2 text-xs text-text-tertiary">
        All Stages must add up to 100.00%.
      </p>

      <label className="mt-6 block text-sm text-text-secondary" htmlFor="premium">
        Minimum premium
      </label>
      <div className="mt-2 flex items-center border border-line-default bg-surface-1">
        <input
          id="premium"
          inputMode="decimal"
          value={(stage.minPremiumBps / 100).toFixed(2)}
          onChange={event => {
            const parsed = parseSignedPercentage(event.target.value);
            if (parsed !== undefined) onChange({ ...stage, minPremiumBps: parsed });
          }}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-text-primary outline-none"
        />
        <span className="px-3 text-sm text-text-tertiary">%</span>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm text-text-secondary">Allowed sessions</legend>
        <div className="mt-3 space-y-2">
          {market.allowedSessions.map(session => {
            const selected = stage.allowedSessions.includes(session);
            return (
              <label key={session} className="flex min-h-11 items-center gap-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    onChange({
                      ...stage,
                      allowedSessions: selected
                        ? stage.allowedSessions.filter(value => value !== session)
                        : [...stage.allowedSessions, session],
                    })
                  }
                />
                {sessionLabels[session]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </aside>
  );
}

function parsePercentage(value: string): number | undefined {
  if (!/^\d{0,3}(\.\d{0,2})?$/.test(value)) return undefined;
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function parseSignedPercentage(value: string): number | undefined {
  if (!/^-?\d{0,4}(\.\d{0,2})?$/.test(value)) return undefined;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const parsed = parsePercentage(unsigned);
  return parsed === undefined ? undefined : negative ? -parsed : parsed;
}
