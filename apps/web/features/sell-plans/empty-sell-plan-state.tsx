import Link from 'next/link';

export function EmptySellPlanState() {
  return <section className="mx-auto max-w-2xl border-y border-line-default py-8"><h1 className="text-2xl font-medium text-text-primary">There isn&apos;t any supported stock available to commit from this wallet.</h1><Link href="/portfolio" className="mt-5 inline-flex min-h-11 items-center text-text-primary underline">Back to portfolio</Link></section>;
}
