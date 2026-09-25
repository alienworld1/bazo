import Link from 'next/link';

export function LandingNavigation() {
  return (
    <header className="border-b border-line-subtle">
      <nav
        aria-label="Landing navigation"
        className="mx-auto flex min-h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10 xl:px-12"
      >
        <Link
          href="/"
          aria-label="Bazo home"
          className="inline-flex shrink-0 items-center"
        >
          <span className="text-xl font-semibold tracking-tight text-text-primary">
            Bazo
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-5">
          <a
            href="#how-it-works"
            className="hidden text-sm text-text-secondary transition-colors hover:text-text-primary sm:inline"
          >
            How it works
          </a>
          <a
            href="#supported-market"
            className="hidden text-sm text-text-secondary transition-colors hover:text-text-primary sm:inline"
          >
            Supported market
          </a>
          <Link
            href="/markets"
            className="inline-flex min-h-10 items-center rounded border border-line-strong px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2"
          >
            Open Bazo
          </Link>
        </div>
      </nav>
    </header>
  );
}
