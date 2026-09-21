'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletControl } from './wallet-control';

const navigation = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/markets', label: 'Markets' },
  { href: '/sell-plans/new', label: 'Create plan' },
  { href: '/activity', label: 'Activity' },
];

export function TopNavigation() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line-subtle">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex h-16 max-w-screen-2xl items-center gap-5 px-4 sm:px-6 lg:px-10 xl:px-12"
      >
        <Link
          href="/"
          className="mr-3 text-lg font-semibold tracking-tight text-text-primary"
        >
          Bazo
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {navigation.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-3 py-2 text-sm transition-colors ${pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <span className="hidden rounded border border-line-default px-2 py-1 font-mono text-xs text-text-secondary sm:block">
          Devnet
        </span>
        <WalletControl />
      </nav>
    </header>
  );
}
