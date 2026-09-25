'use client';

import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { solanaClient } from '@/components/solana-client';
import type { WalletActivity as ActivityItem } from '@/server/wallet-activity';

export function WalletActivity({ limit }: { limit?: number }) {
  const owner = useConnectedWallet(solanaClient)?.account.address;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    owner: string;
    items: ActivityItem[];
    partial: boolean;
    error: boolean;
  }>();
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      try {
        const response = await fetch(`/api/wallets/${owner}/activity`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('activity read failed');
        const result = (await response.json()) as {
          items: ActivityItem[];
          partial: boolean;
        };
        if (!controller.signal.aborted)
          setState({ owner, ...result, error: false });
      } catch {
        if (!controller.signal.aborted)
          setState({ owner, items: [], partial: false, error: true });
      }
    });
    return () => controller.abort();
  }, [owner, revision]);

  if (!owner)
    return (
      <p className="mt-6 text-text-secondary">
        Connect a Solana wallet to see your activity.
      </p>
    );
  if (!state || state.owner !== owner)
    return (
      <p className="mt-6 text-text-secondary" aria-live="polite">
        Reading your activity…
      </p>
    );
  if (state.error)
    return (
      <div className="mt-6" role="alert">
        <p className="text-text-secondary">
          We couldn&apos;t load the latest activity. Try again.
        </p>
        <button
          onClick={() => setRevision(value => value + 1)}
          className="mt-3 min-h-11 underline"
        >
          Retry
        </button>
      </div>
    );
  return (
    <div className="mt-8">
      {state.partial ? (
        <p
          role="status"
          className="border-l-2 border-warning pl-3 text-sm text-warning"
        >
          Some older activity couldn&apos;t be verified. The history below may
          be incomplete.
        </p>
      ) : null}
      {state.items.length === 0 && !state.partial ? (
        <p className="text-text-secondary">
          No activity yet. Your confirmed actions will appear here.
        </p>
      ) : null}
      <ol className="mt-5 divide-y divide-line-default border-y border-line-default">
        {state.items.slice(0, limit).map(item => (
          <li
            key={item.id}
            className="grid gap-2 py-5 sm:grid-cols-[11rem_1fr]"
          >
            <time
              className="font-mono text-xs text-text-tertiary"
              dateTime={activityDate(item.occurredAtUnix)?.toISOString()}
            >
              {activityDate(item.occurredAtUnix)?.toLocaleString() ??
                'Time unavailable'}
            </time>
            <div>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center font-medium text-text-primary underline decoration-line-strong underline-offset-4"
              >
                {item.title}
              </Link>
              <p className="text-sm text-text-secondary">{item.detail}</p>
              {item.signature ? (
                <a
                  href={`https://explorer.solana.com/tx/${item.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex min-h-11 items-center text-sm text-text-primary underline"
                >
                  View transaction
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {limit ? (
        <Link
          href="/activity"
          className="mt-5 inline-flex min-h-11 items-center text-sm underline"
        >
          View all activity
        </Link>
      ) : (
        <button
          onClick={() => setRevision(value => value + 1)}
          className="mt-5 min-h-11 text-sm underline"
        >
          Refresh activity
        </button>
      )}
    </div>
  );
}

function activityDate(unix: string | null): Date | null {
  if (!unix || !/^\d+$/.test(unix)) return null;
  const milliseconds = Number(unix) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 8.64e15)
    return null;
  return new Date(milliseconds);
}
