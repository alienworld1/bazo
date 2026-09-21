import Link from 'next/link';
import { AppShell } from '@/components/app-shell';

export default function NotFound() {
  return (
    <AppShell>
      <section className="mx-auto max-w-5xl py-16">
        <h1 className="text-3xl font-medium text-text-primary">
          We couldn&apos;t find that Market.
        </h1>
        <Link
          href="/markets"
          className="mt-6 inline-flex min-h-11 items-center rounded border border-line-default px-4 text-sm text-text-primary"
        >
          Back to Markets
        </Link>
      </section>
    </AppShell>
  );
}
