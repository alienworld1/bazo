'use client';

import { address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { withdrawRemainingStockInstruction } from '@bazo/sdk';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ownerTokenDestination } from '@/components/owner-token-destination';
import { simulateWalletTransaction } from '@/components/simulate-wallet-transaction';
import { solanaClient } from '@/components/solana-client';

type Props = {
  programAddress: string;
  plan: string;
  owner: string;
  market: string;
  stockMint: string;
  stockTokenProgram: string;
  stockVault: string;
  rawAmount: string;
  stockSymbol: string;
};

export function WithdrawRemainingStock(props: Props) {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  if (BigInt(props.rawAmount) === 0n) return null;
  if (!connected || connected.account.address !== props.owner)
    return (
      <p className="mt-3 text-sm text-text-secondary">
        Connect the wallet that owns this Plan to recover remaining stock.
      </p>
    );

  const prepare = async () => {
    setError(undefined);
    try {
      const target = await ownerTokenDestination({
        owner: props.owner,
        mint: props.stockMint,
        tokenProgram: props.stockTokenProgram,
      });
      setDestination(target.address);
    } catch {
      setError(
        "We couldn't prepare your stock account. Refresh and try again.",
      );
    }
  };

  const submit = async () => {
    if (!destination || progress) return;
    setError(undefined);
    setProgress('Preparing transaction…');
    try {
      const target = await ownerTokenDestination({
        owner: props.owner,
        mint: props.stockMint,
        tokenProgram: props.stockTokenProgram,
      });
      if (target.address !== destination)
        throw new Error('destination changed');
      const instruction = await withdrawRemainingStockInstruction({
        programAddress: address(props.programAddress),
        owner: address(props.owner),
        market: address(props.market),
        plan: address(props.plan),
        stockMint: address(props.stockMint),
        stockTokenProgram: address(props.stockTokenProgram),
        stockVault: address(props.stockVault),
        ownerStockDestination: address(destination),
      });
      const existing = await solanaClient.rpc
        .getAccountInfo(address(destination), {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send();
      const before = existing.value
        ? (
            await solanaClient.rpc
              .getTokenAccountBalance(address(destination))
              .send()
          ).value.amount
        : '0';
      await simulateWalletTransaction([target.createInstruction, instruction]);
      setProgress('Awaiting approval…');
      await solanaClient.sendTransaction([
        target.createInstruction,
        instruction,
      ]);
      setProgress('Checking confirmation…');
      const [response, balance] = await Promise.all([
        fetch(`/api/sell-plans/${props.plan}`, { cache: 'no-store' }),
        solanaClient.rpc.getTokenAccountBalance(address(destination)).send(),
      ]);
      if (!response.ok) throw new Error('confirmation unavailable');
      const updated = (await response.json()) as {
        remainingRawInventory: string;
        stockVaultRawAmount: string;
      };
      if (
        updated.remainingRawInventory !== '0' ||
        updated.stockVaultRawAmount !== '0' ||
        BigInt(balance.value.amount) - BigInt(before) !==
          BigInt(props.rawAmount)
      )
        throw new Error('confirmation uncertain');
      setDestination(undefined);
      setProgress(undefined);
      router.refresh();
    } catch {
      setProgress(undefined);
      setError(
        "We couldn't verify the return yet. Refresh this Plan before trying again.",
      );
    }
  };

  return (
    <section
      className="mt-8 border-t border-line-default pt-5"
      aria-live="polite"
    >
      <h2 className="text-lg font-medium text-text-primary">Remaining stock</h2>
      <p className="mt-2 text-sm text-text-secondary">
        {props.rawAmount} raw {props.stockSymbol} units are ready to return to
        your wallet.
      </p>
      {destination ? (
        <div className="mt-4 text-sm">
          <p className="text-text-secondary">
            Devnet · your wallet pays the network fee and may create its stock
            account.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-text-tertiary">
            Destination: {destination}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={Boolean(progress)}
              className="min-h-11 border border-line-strong bg-surface-3 px-4 text-text-primary disabled:text-text-disabled"
            >
              Approve return
            </button>
            <button
              type="button"
              onClick={() => setDestination(undefined)}
              disabled={Boolean(progress)}
              className="min-h-11 border border-line-default px-4 text-text-primary"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void prepare()}
          className="mt-4 min-h-11 border border-line-default px-4 text-sm text-text-primary"
        >
          Withdraw remaining stock
        </button>
      )}
      {progress ? (
        <p className="mt-3 text-sm text-text-secondary">{progress}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
