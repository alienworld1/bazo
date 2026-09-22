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
}: {
  plan: string;
  owner: string;
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
  const preview =
    connected?.account.address === owner
      ? getPrivatePlanPreview(plan, owner)
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
            <span className="font-medium text-text-primary">
              Stage {stage.index + 1}
            </span>
            <span className="ml-3">{stage.rawQuantity} raw</span>
            <span className="ml-3">{formatPremium(stage.minPremiumBps)}</span>
            <span className="ml-3">{stage.allowedSessions.join(', ')}</span>
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
