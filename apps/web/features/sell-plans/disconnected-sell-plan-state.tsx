import Link from 'next/link';

export function DisconnectedSellPlanState() {
  return <section className="mx-auto max-w-2xl border-y border-line-default py-8"><h1 className="text-2xl font-medium text-text-primary">Connect a Solana wallet to create a Sell Plan.</h1><Link href="/portfolio" className="mt-5 inline-flex min-h-11 items-center text-text-primary underline">Back to portfolio</Link></section>;
}
