import Link from 'next/link';
import { DevnetStockClaim } from './devnet-stock-claim';

export function EmptySellPlanState({
  market,
  programAddress,
  onClaimed,
}: {
  market: {
    symbol: string;
    stockMint: string;
    quoteMint: string;
    stockTokenProgram: string;
  };
  programAddress: string;
  onClaimed: () => Promise<void>;
}) {
  return (
    <section className="mx-auto max-w-2xl border-y border-line-default py-8">
      <h1 className="text-2xl font-medium text-text-primary">
        There isn&apos;t any supported stock available to commit from this wallet.
      </h1>
      <DevnetStockClaim
        marketSymbol={market.symbol}
        stockMint={market.stockMint}
        quoteMint={market.quoteMint}
        stockTokenProgram={market.stockTokenProgram}
        programAddress={programAddress}
        onClaimed={onClaimed}
      />
      <Link
        href="/portfolio"
        className="mt-5 inline-flex min-h-11 items-center text-text-primary underline"
      >
        Back to portfolio
      </Link>
    </section>
  );
}
