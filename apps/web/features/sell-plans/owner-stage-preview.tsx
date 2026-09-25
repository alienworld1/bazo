'use client';

import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useEffect, useSyncExternalStore } from 'react';
import { solanaClient } from '@/components/solana-client';
import {
  clearPrivatePlansExcept,
  getPrivatePlanPreview,
  getPrivatePlanRevision,
  subscribeToPrivatePlans,
} from './private-plan-memory';

export function OwnerStagePreview({
  plan,
  owner,
  currentStageIndex,
  currentCommitment,
}: {
  plan: string;
  owner: string;
  currentStageIndex: number;
  currentCommitment: string;
}) {
  const connected = useConnectedWallet(solanaClient);
  useSyncExternalStore(
    subscribeToPrivatePlans,
    getPrivatePlanRevision,
    getPrivatePlanRevision,
  );
  useEffect(() => {
    clearPrivatePlansExcept(connected?.account.address);
  }, [connected?.account.address]);
  const candidate =
    connected?.account.address === owner
      ? getPrivatePlanPreview(plan, owner)
      : undefined;
  const preview =
    candidate?.package.stages[currentStageIndex]?.commitment &&
    Array.from(candidate.package.stages[currentStageIndex].commitment, byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('') === currentCommitment
      ? candidate
      : undefined;
  if (!preview) {
    return (
      <p className="mt-6 text-sm text-text-secondary">
        Private Stage details aren&apos;t available in this browser yet. The
        funded Plan is still visible and your stock remains in program custody.
      </p>
    );
  }
  return (
    <section className="mt-8 border-t border-line-default pt-6">
      <h2 className="text-lg font-medium text-text-primary">
        Your sealed Stage sequence
      </h2>
      <ol className="mt-4 space-y-3">
        {preview.stages.map(stage => (
          <li
            key={stage.index}
            className="border-b border-line-subtle pb-3 text-sm text-text-secondary"
          >
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-text-primary">
                Stage {stage.index + 1} ·{' '}
                {stage.index < currentStageIndex ? 'Executed' : 'Sealed'}
              </summary>
              <p className="pb-3 pl-4">
                {stage.rawQuantity} raw · {formatPremium(stage.minPremiumBps)} ·{' '}
                {stage.allowedSessions.join(', ')}
              </p>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatPremium(bps: number) {
  const value = (bps / 100).toFixed(2);
  return `${bps >= 0 ? '+' : ''}${value}% minimum`;
}
