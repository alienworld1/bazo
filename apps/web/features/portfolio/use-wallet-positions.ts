'use client';

import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useCallback, useEffect, useState } from 'react';
import { solanaClient } from '@/components/solana-client';
import type { VerifiedPublicSellPlan } from '@/server/plans';
import type { VerifiedBuyRequest } from '@/server/buy-requests';

type Positions = {
  plans: VerifiedPublicSellPlan[];
  requests: VerifiedBuyRequest[];
  partial: boolean;
  multipliers: Record<string, string>;
};

export function useWalletPositions() {
  const wallet = useConnectedWallet(solanaClient);
  const owner = wallet?.account.address;
  const [state, setState] = useState<{
    owner: string;
    data?: Positions;
    loading: boolean;
    error: boolean;
  }>();
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      setState({ owner, loading: true, error: false });
      try {
        const response = await fetch(`/api/wallets/${owner}/positions`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('position read failed');
        const data = (await response.json()) as Positions;
        if (!controller.signal.aborted)
          setState({ owner, data, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted)
          setState({ owner, loading: false, error: true });
      }
    });
    return () => controller.abort();
  }, [owner, revision]);

  return {
    owner,
    data: state?.owner === owner ? state?.data : undefined,
    loading:
      Boolean(owner) && (!state || state.owner !== owner || state.loading),
    error: state?.owner === owner && state?.error,
    reload,
  };
}
