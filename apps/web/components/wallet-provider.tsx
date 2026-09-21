'use client';

import type { ReactNode } from 'react';
import { ClientProvider } from '@solana/react';
import { solanaClient } from './solana-client';

export function WalletConnectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <ClientProvider client={solanaClient}>{children}</ClientProvider>;
}
