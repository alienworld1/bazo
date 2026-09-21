'use client';

import { useSyncExternalStore } from 'react';
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useWallets,
} from '@solana/kit-plugin-wallet/react';
import { solanaClient } from './solana-client';

const subscribeToHydration = () => () => undefined;

function useHasHydrated() {
  return useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

export function WalletControl() {
  const hasHydrated = useHasHydrated();
  const isWalletReady = useIsWalletReady(solanaClient);
  const connected = useConnectedWallet(solanaClient);
  const wallets = useWallets(solanaClient);
  const {
    dispatch: connect,
    error: connectionError,
    isRunning: isConnecting,
  } = useConnect(solanaClient);
  const { dispatch: disconnect } = useDisconnect(solanaClient);

  if (!hasHydrated || !isWalletReady) {
    return (
      <span className="inline-flex min-h-11 items-center rounded border border-line-default px-3 text-sm text-text-secondary">
        Loading wallet…
      </span>
    );
  }

  if (connected) {
    const address = connected.account.address;
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="min-h-11 rounded border border-line-default px-3 font-mono text-xs text-text-primary hover:border-line-strong"
        aria-label="Disconnect wallet"
      >
        {address.slice(0, 4)}…{address.slice(-4)}
      </button>
    );
  }

  return (
    <div className="relative">
      <details>
        <summary className="min-h-11 cursor-pointer list-none rounded border border-line-default px-3 py-3 text-sm text-text-primary hover:border-line-strong">
          {isConnecting ? 'Connecting wallet…' : 'Connect wallet'}
        </summary>
        <div className="absolute right-0 top-12 z-10 w-56 rounded border border-line-default bg-surface-transient p-2">
          {wallets.length ? (
            wallets.map(wallet => (
              <button
                key={wallet.name}
                type="button"
                disabled={isConnecting}
                onClick={() => connect(wallet)}
                className="block min-h-11 w-full rounded px-3 text-left text-sm text-text-primary hover:bg-surface-2 disabled:text-text-disabled"
              >
                {wallet.name}
              </button>
            ))
          ) : (
            <p className="p-3 text-xs text-text-secondary">
              We couldn&apos;t connect to that wallet. Check that it&apos;s
              installed and unlocked, then try again.
            </p>
          )}
        </div>
      </details>
      {connectionError ? (
        <p
          role="status"
          className="absolute right-0 top-12 w-64 rounded border border-line-default bg-surface-transient p-3 text-xs text-text-secondary"
        >
          Connection canceled. Choose a wallet when you&apos;re ready.
        </p>
      ) : null}
    </div>
  );
}
