'use client';

import { useEffect, useRef, useState } from 'react';

type DemoPhase = 'ready' | 'matching' | 'sold';

export function LandingPlanDemo() {
  const [phase, setPhase] = useState<DemoPhase>('ready');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function playOrReset() {
    if (timer.current) clearTimeout(timer.current);
    if (phase === 'sold') {
      setPhase('ready');
      return;
    }
    setPhase('matching');
    timer.current = setTimeout(() => {
      setPhase('sold');
      timer.current = null;
    }, 900);
  }

  const sold = phase === 'sold';

  return (
    <figure
      className="min-w-0 border border-line-strong bg-surface-1 p-4 sm:p-6"
      aria-label={
        sold
          ? 'Illustrated Sell Plan with two completed sales and a current step'
          : 'Illustrated Sell Plan with a completed sale, a current sale, and a future sealed step'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-default pb-5">
        <div>
          <p className="font-mono text-[11px] tracking-wider text-text-tertiary">
            EXAMPLE SELL PLAN / PUBLIC VIEW
          </p>
          <p className="mt-2 text-lg font-medium text-text-primary">
            A sale, then the next
          </p>
        </div>
        <span className="border border-line-default px-2 py-1 font-mono text-[11px] text-text-secondary">
          ILLUSTRATION
        </span>
      </div>
      <div className="py-7 sm:py-10">
        <ol
          className={`grid grid-cols-1 items-stretch border-b border-line-default transition-[grid-template-columns] duration-(--duration-stage) sm:border-b-0 ${sold ? 'sm:grid-cols-[0.8fr_0.8fr_1.3fr]' : 'sm:grid-cols-[0.8fr_1.3fr_0.8fr]'}`}
        >
          <li className="min-w-0 border-t-2 border-executed bg-surface-2 px-3 py-3 sm:px-4 sm:py-5">
            <p className="font-mono text-xs text-executed">01 / SOLD</p>
            <p className="mt-3 text-sm font-medium text-text-primary sm:mt-6 sm:text-base">
              3 stock tokens sold
            </p>
            <p className="mt-2 text-xs text-text-secondary">Sale recorded</p>
          </li>
          <li
            className={`min-w-0 border-t-2 bg-surface-2 px-3 py-3 transition-all duration-(--duration-stage) sm:border-l sm:border-l-line-default sm:px-4 sm:py-5 ${sold ? 'border-executed' : 'border-active bg-surface-3'}`}
          >
            <p
              className={`font-mono text-xs transition-colors duration-(--duration-stage) ${sold ? 'text-executed' : 'text-active'}`}
            >
              02 / {sold ? 'SOLD' : 'CURRENT'}
            </p>
            <p className="mt-3 text-sm font-medium text-text-primary sm:mt-6 sm:text-base">
              {sold ? '4 stock tokens sold' : 'Sale terms hidden'}
            </p>
            <p className="mt-2 text-xs text-text-secondary">
              {sold
                ? 'Sale recorded'
                : phase === 'matching'
                  ? 'Sample buyers match'
                  : 'Waiting for buyers'}
            </p>
          </li>
          <li
            className={`min-w-0 border-t-2 px-3 py-3 transition-all duration-(--duration-stage) sm:border-l sm:border-l-line-default sm:px-4 sm:py-5 ${sold ? 'border-active bg-surface-3' : 'border-sealed bg-surface-1'}`}
          >
            <p
              className={`font-mono text-xs transition-colors duration-(--duration-stage) ${sold ? 'text-active' : 'text-sealed'}`}
            >
              03 / {sold ? 'CURRENT' : 'FUTURE'}
            </p>
            <p className="mt-3 text-sm font-medium text-text-primary sm:mt-6 sm:text-base">
              Sale terms hidden
            </p>
            <p className="mt-2 text-xs text-text-secondary">
              {sold ? 'Waiting for buyers' : 'Sealed for later'}
            </p>
          </li>
        </ol>
        <div className="mt-4 h-1 bg-line-subtle">
          <div
            className={`h-full bg-active transition-[width] duration-(--duration-stage) ${phase === 'ready' ? 'w-1/3' : phase === 'matching' ? 'w-1/2' : 'w-2/3'}`}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-default pt-5">
        <figcaption className="max-w-xs text-xs leading-5 text-text-tertiary">
          Illustration only. No live orders, prices, or transactions are shown.
        </figcaption>
        <button
          type="button"
          onClick={playOrReset}
          disabled={phase === 'matching'}
          className="inline-flex min-h-11 items-center rounded border border-line-strong px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
        >
          {sold
            ? 'Reset example'
            : phase === 'matching'
              ? 'Matching sample buyers…'
              : 'Play a sample sale'}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {sold
          ? 'Sample sale recorded. The next step is current and its terms remain hidden.'
          : phase === 'matching'
            ? 'Sample buyers are matching the current step.'
            : 'Example plan ready.'}
      </p>
    </figure>
  );
}
