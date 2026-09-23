'use client';

import { hashCanonicalStage, toHex } from '@bazo/plan-crypto';
import { serializeOpening } from '@bazo/sdk';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { solanaClient } from '@/components/solana-client';
import { authenticatePrivateStorage } from './recovery/private-storage-client';
import {
  getPrivatePlanPackage,
  getPrivatePlanRevision,
  subscribeToPrivatePlans,
} from './private-plan-memory';

export function CurrentStageDelivery({
  plan,
  owner,
  stageIndex,
  commitment,
}: {
  plan: string;
  owner: string;
  stageIndex: number;
  commitment: string;
}) {
  const connected = useConnectedWallet(solanaClient);
  useSyncExternalStore(
    subscribeToPrivatePlans,
    getPrivatePlanRevision,
    getPrivatePlanRevision,
  );
  const [status, setStatus] = useState<'idle' | 'sending' | 'delivered'>(
    'idle',
  );
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (connected?.account.address !== owner) return;
    let alive = true;
    fetch(`/api/sell-plans/${plan}/opening`, { cache: 'no-store' })
      .then(response =>
        response.ok
          ? (response.json() as Promise<{ delivered: boolean }>)
          : { delivered: false },
      )
      .then(result => {
        if (alive) setStatus(result.delivered ? 'delivered' : 'idle');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connected?.account.address, owner, plan, stageIndex, commitment]);
  if (connected?.account.address !== owner)
    return (
      <p className="mt-8 border-t border-line-default pt-5 text-sm text-text-secondary">
        Connect the wallet that owns this Plan to provide matching details.
      </p>
    );
  const stage = getPrivatePlanPackage(plan, owner)?.stages[stageIndex];
  const deliver = async () => {
    if (!stage) return;
    setStatus('sending');
    setError(undefined);
    try {
      const { commitment: storedCommitment, ...opening } = stage;
      if (
        toHex(storedCommitment) !== commitment ||
        toHex(await hashCanonicalStage(opening)) !== commitment ||
        opening.plan !== plan ||
        opening.stageIndex !== stageIndex
      )
        throw new Error('stale stage');
      await authenticatePrivateStorage(owner);
      const response = await fetch(`/api/sell-plans/${plan}/opening`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(serializeOpening(opening)),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('delivery failed');
      setStatus('delivered');
    } catch {
      setStatus('idle');
      setError(
        'Matching details need attention. Restore the current Plan backup or retry delivery.',
      );
    }
  };

  return (
    <section
      className="mt-8 border-t border-line-default pt-5"
      aria-live="polite"
    >
      <h2 className="text-lg font-medium text-text-primary">
        Current Stage matching
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {status === 'delivered'
          ? 'Your current Stage details reached the coordinator. No sale has completed yet.'
          : stage
            ? 'Provide only the current Stage details to check for a full match.'
            : 'Matching details need attention. Restore your Plan backup to provide the current Stage.'}
      </p>
      {stage ? (
        <button
          type="button"
          onClick={() => void deliver()}
          disabled={status === 'sending'}
          className="mt-4 min-h-11 border border-line-strong bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled"
        >
          {status === 'sending'
            ? 'Sending details…'
            : status === 'delivered'
              ? 'Retry delivery'
              : 'Provide matching details'}
        </button>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
