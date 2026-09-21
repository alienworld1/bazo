'use client';

import type { DraftStage } from './sell-plan-types';

export function StageDraftCard({
  index,
  stage,
  rawQuantity,
  selected,
  onSelect,
  onMoveEarlier,
  onMoveLater,
  canMoveLater,
  onRemove,
}: {
  index: number;
  stage: DraftStage;
  rawQuantity: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  canMoveLater: boolean;
  onRemove: () => void;
}) {
  return (
    <li
      className={`min-w-52 rounded-[9px] border p-4 ${selected ? 'border-line-strong bg-surface-3' : 'border-line-default bg-surface-1'}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left"
        aria-pressed={selected}
      >
        <span className="font-mono text-xs text-text-tertiary">
          STAGE {index + 1}
        </span>
        <span className="mt-3 block text-lg font-medium text-text-primary">
          {(stage.allocationBps / 100).toFixed(2)}%
        </span>
        <span className="mt-1 block text-sm text-text-secondary">
          Minimum {formatPremium(stage.minPremiumBps)}
        </span>
        <span className="mt-3 block font-mono text-xs text-text-tertiary">
          {rawQuantity ? `${rawQuantity} raw units` : 'Set committed amount'}
        </span>
      </button>
      <div className="mt-4 flex gap-2 border-t border-line-subtle pt-3">
        <button
          type="button"
          onClick={onMoveEarlier}
          disabled={index === 0}
          className="min-h-11 text-xs text-text-secondary disabled:text-text-disabled"
        >
          Move earlier
        </button>
        <button
          type="button"
          onClick={onMoveLater}
          disabled={!canMoveLater}
          className="min-h-11 text-xs text-text-secondary disabled:text-text-disabled"
        >
          Move later
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto min-h-11 text-xs text-text-secondary"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function formatPremium(value: number): string {
  const formatted = (Math.abs(value) / 100).toFixed(2);
  return `${value >= 0 ? '+' : '−'}${formatted}%`;
}
