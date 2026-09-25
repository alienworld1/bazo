'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletControl } from './wallet-control';

const navigation = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/markets', label: 'Markets' },
  { href: '/sell-plans/new', label: 'Create plan' },
  { href: '/activity', label: 'Activity' },
  { href: '/settings/security', label: 'Security' },
];

export function TopNavigation() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line-subtle">
      <nav
        aria-label="Primary navigation"
        className="mx-auto grid max-w-screen-2xl grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex sm:h-16 sm:gap-5 sm:px-6 sm:py-0 lg:px-10 xl:px-12"
      >
        <Link
          href="/"
          className="mr-3 text-lg font-semibold tracking-tight text-text-primary"
        >
          Bazo
        </Link>
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-1 sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:overflow-x-auto">
          {navigation.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-2 py-1.5 text-sm transition-colors sm:px-3 sm:py-2 ${pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <span className="hidden rounded border border-line-default px-2 py-1 font-mono text-xs text-text-secondary sm:block">
          Devnet
        </span>
        <div className="col-start-2 row-start-1 justify-self-end">
          <WalletControl />
        </div>
      </nav>
    </header>
  );
}
