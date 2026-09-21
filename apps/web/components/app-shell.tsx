import type { ReactNode } from 'react';
import { TopNavigation } from './top-navigation';
import { WalletConnectionProvider } from './wallet-provider';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletConnectionProvider>
      <TopNavigation />
      <main className="mx-auto w-full max-w-screen-2xl px-4 py-10 sm:px-6 lg:px-10 xl:px-12">
        {children}
      </main>
    </WalletConnectionProvider>
  );
}
