'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import {
  buildCommitmentChain,
  randomPlanNonce,
  randomSalt,
  toHex,
} from '@bazo/plan-crypto';
import { deriveMarketAddress, derivePlanAddresses } from '@bazo/sdk';
import { allocateStageInventory } from '@/lib/stage-allocation';
import {
  formatDisplayAmount,
  parseDisplayAmountToRaw,
} from '@/lib/token-amounts';
import { solanaClient } from '@/components/solana-client';
import { StageDraftCard } from './stage-draft-card';
import { StageEditor } from './stage-editor';
import type {
  DraftStage,
  LoadedHolding,
  PreparedSellPlan,
  SellPlanMarket,
} from './sell-plan-types';

const defaultPremiums = [50, 100, 200, 400];

export function SellPlanComposer({
  market,
  programAddress,
}: {
  market: SellPlanMarket;
  programAddress: string;
}) {
  const connected = useConnectedWallet(solanaClient);
  const owner = connected?.account.address;
  const [holding, setHolding] = useState<LoadedHolding>();
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState(false);
  const [inputMode, setInputMode] = useState<'percentage' | 'displayAmount'>(
    'percentage',
  );
  const [committedInput, setCommittedInput] = useState('');
  const [stages, setStages] = useState<DraftStage[]>(() => createDefaultStages(market));
  const [selectedStageId, setSelectedStageId] = useState(() => stages[0]?.id ?? '');
  const [expiry, setExpiry] = useState('');
  const [prepared, setPrepared] = useState<PreparedSellPlan>();
  const [preparing, setPreparing] = useState(false);

  const loadHolding = useCallback(async () => {
    if (!owner) return;
    setLoading(true);
    setReadError(false);
    try {
      const response = await fetch(
        `/api/markets/${market.id}/holding?owner=${encodeURIComponent(owner)}`,
      );
      if (!response.ok) throw new Error('holding read failed');
      setHolding(await response.json());
    } catch {
      setReadError(true);
    } finally {
      setLoading(false);
    }
  }, [market.id, owner]);

  useEffect(() => {
    if (owner) void Promise.resolve().then(loadHolding);
  }, [loadHolding, owner]);

  const committedRawAmount = useMemo(() => {
    if (!holding || !committedInput) return undefined;
    try {
      if (inputMode === 'percentage') {
        const basisPoints = parsePercentageBasisPoints(committedInput);
        return (BigInt(holding.rawAmount) * BigInt(basisPoints)) / 10_000n;
      }
      return BigInt(
        parseDisplayAmountToRaw(
          committedInput,
          holding.decimals,
          holding.multiplierContext ?? '1',
        ),
      );
    } catch {
      return undefined;
    }
  }, [committedInput, holding, inputMode]);

  const allocations = useMemo(() => {
    if (!committedRawAmount || committedRawAmount <= 0n) return undefined;
    try {
      return allocateStageInventory(
        committedRawAmount,
        stages.map(stage => stage.allocationBps),
      );
    } catch {
      return undefined;
    }
  }, [committedRawAmount, stages]);
  const selectedStage = stages.find(stage => stage.id === selectedStageId) ?? stages[0];
  const validationError = validateDraft({
    holding,
    committedRawAmount,
    allocations,
    stages,
    expiry,
    market,
  });
  const review = async () => {
    if (validationError || !holding || !committedRawAmount || !allocations || !owner) return;
    setPreparing(true);
    try {
      const nonce = randomPlanNonce();
      const marketAddress = await deriveMarketAddress(programAddress as never, {
        stockMint: market.stockMint as never,
        quoteMint: market.quoteMint as never,
      });
      const addresses = await derivePlanAddresses({
        programAddress: programAddress as never,
        owner: owner as never,
        market: marketAddress,
        planNonce: nonce,
      });
      const chain = await buildCommitmentChain(
        stages.map((stage, index) => ({
          schemaVersion: 1,
          network: 1,
          plan: addresses.plan,
          market: marketAddress,
          stageIndex: index,
          rawQuantity: allocations[index]?.rawQuantity ?? 0n,
          minPremiumBps: stage.minPremiumBps,
          allowedSessionMask: sessionMask(stage.allowedSessions),
          maxReferenceAgeSeconds: market.maxReferenceAgeSeconds,
          salt: randomSalt(),
        })),
      );
      setPrepared({
        plan: addresses.plan,
        stockVault: addresses.stockVault,
        proceedsVault: addresses.proceedsVault,
        headCommitment: toHex(chain.headCommitment),
        rawAmount: committedRawAmount.toString(),
        displayAmount: formatDisplayAmount(
          committedRawAmount.toString(),
          holding.decimals,
          holding.multiplierContext ?? '1',
        ),
        expiresAt: new Date(expiry).toLocaleString(),
      });
    } finally {
      setPreparing(false);
    }
  };

  if (!connected) {
    return <DisconnectedState />;
  }
  if (loading || !holding) {
    return <p className="text-sm text-text-secondary">Checking your position…</p>;
  }
  if (readError) {
    return (
      <div role="alert" className="border-y border-line-default py-6 text-text-secondary">
        We couldn&apos;t refresh your position. Nothing moved. Try again before reviewing your Plan.
        <button type="button" onClick={() => void loadHolding()} className="ml-3 underline">
          Retry
        </button>
      </div>
    );
  }
  if (holding.rawAmount === '0') {
    return <NoBalanceState />;
  }
  if (prepared) {
    return <PreparedReview prepared={prepared} onBack={() => setPrepared(undefined)} />;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <p className="font-mono text-xs text-text-tertiary">CREATE SELL PLAN</p>
      <h1 className="mt-3 text-3xl font-medium text-text-primary">Shape your future sell path</h1>
      <p className="mt-3 max-w-2xl text-text-secondary">
        Choose the stock to commit, then set the protections that apply to each future Stage.
      </p>
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(280px,4fr)]">
        <section>
          <AmountControl
            holding={holding}
            inputMode={inputMode}
            committedInput={committedInput}
            onModeChange={mode => {
              setInputMode(mode);
              setPrepared(undefined);
            }}
            onInputChange={value => {
              setCommittedInput(value);
              setPrepared(undefined);
            }}
            committedRawAmount={committedRawAmount}
          />
          <div className="mt-10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-text-primary">Stage sequence</h2>
                <p className="mt-1 text-sm text-text-secondary">Editable example</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (stages.length >= 6) return;
                  const id = crypto.randomUUID();
                  setStages(current => [
                    ...current,
                    { id, allocationBps: 1, minPremiumBps: 0, allowedSessions: ['regular'] },
                  ]);
                  setSelectedStageId(id);
                }}
                disabled={stages.length >= 6}
                className="min-h-11 border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
              >
                Add Stage
              </button>
            </div>
            <ol className="mt-5 flex gap-3 overflow-x-auto pb-2" aria-label="Sell Plan Stages">
              {stages.map((stage, index) => (
                <StageDraftCard
                  key={stage.id}
                  index={index}
                  stage={stage}
                  rawQuantity={allocations?.[index]?.rawQuantity.toString()}
                  selected={stage.id === selectedStage?.id}
                  onSelect={() => setSelectedStageId(stage.id)}
                  onMoveEarlier={() => moveStage(stages, setStages, index, -1)}
                  onMoveLater={() => moveStage(stages, setStages, index, 1)}
                  canMoveLater={index < stages.length - 1}
                  onRemove={() => {
                    if (stages.length <= 2) return;
                    setStages(current => current.filter(item => item.id !== stage.id));
                    if (stage.id === selectedStageId) setSelectedStageId(stages[0]?.id ?? '');
                  }}
                />
              ))}
            </ol>
          </div>
          <label className="mt-10 block text-sm text-text-secondary" htmlFor="expiry">
            Plan end date
          </label>
          <input
            id="expiry"
            type="datetime-local"
            value={expiry}
            onChange={event => setExpiry(event.target.value)}
            className="mt-2 min-h-11 border border-line-default bg-surface-1 px-3 text-sm text-text-primary"
          />
          {validationError ? <p className="mt-4 text-sm text-warning">{validationError}</p> : null}
          <button
            type="button"
            onClick={() => void review()}
            disabled={Boolean(validationError) || preparing}
            className="mt-8 min-h-11 border border-line-strong bg-surface-3 px-5 text-sm text-text-primary disabled:text-text-disabled"
          >
            {preparing ? 'Preparing your sealed Plan…' : 'Review Plan'}
          </button>
        </section>
        {selectedStage ? <StageEditor market={market} stage={selectedStage} onChange={replacement => setStages(current => current.map(stage => stage.id === replacement.id ? replacement : stage))} /> : null}
      </div>
    </div>
  );
}

function AmountControl({ holding, inputMode, committedInput, onModeChange, onInputChange, committedRawAmount }: { holding: LoadedHolding; inputMode: 'percentage' | 'displayAmount'; committedInput: string; onModeChange: (mode: 'percentage' | 'displayAmount') => void; onInputChange: (value: string) => void; committedRawAmount: bigint | undefined }) {
  return <section className="border-y border-line-default py-6"><h2 className="text-lg font-medium text-text-primary">Amount to commit</h2><p className="mt-2 text-sm text-text-secondary">Available: {holding.displayAmount} {holding.displaySymbol}</p><div className="mt-5 flex gap-4 text-sm"><button type="button" onClick={() => onModeChange('percentage')} aria-pressed={inputMode === 'percentage'} className="min-h-11 text-text-primary underline">Use percentage</button><button type="button" onClick={() => onModeChange('displayAmount')} aria-pressed={inputMode === 'displayAmount'} className="min-h-11 text-text-primary underline">Use share amount</button></div><label className="mt-4 block text-sm text-text-secondary" htmlFor="committed-amount">{inputMode === 'percentage' ? 'Percentage of holding' : `Share amount (${holding.displaySymbol})`}</label><input id="committed-amount" inputMode="decimal" value={committedInput} onChange={event => onInputChange(event.target.value)} className="mt-2 min-h-11 w-full max-w-sm border border-line-default bg-surface-1 px-3 font-mono text-sm text-text-primary" />{committedRawAmount !== undefined ? <p className="mt-3 text-sm text-text-secondary">This amount resolves to {formatDisplayAmount(committedRawAmount.toString(), holding.decimals, holding.multiplierContext ?? '1')} {holding.displaySymbol} in onchain units.</p> : null}</section>;
}

function PreparedReview({ prepared, onBack }: { prepared: PreparedSellPlan; onBack: () => void }) { return <section className="mx-auto max-w-3xl border-y border-line-default py-8"><p className="font-mono text-xs text-text-tertiary">REVIEW SELL PLAN</p><h1 className="mt-3 text-3xl font-medium text-text-primary">Your future Stages are ready to seal</h1><p className="mt-4 text-text-secondary">Your future Stages are committed before funding. They stay sealed from public order flow until each Stage can be fully sold.</p><dl className="mt-8 space-y-4 text-sm"><ReviewFact label="Devnet" value="Devnet"/><ReviewFact label="Total committed" value={`${prepared.displayAmount} shares (${prepared.rawAmount} raw)`}/><ReviewFact label="Plan address" value={prepared.plan}/><ReviewFact label="Stock vault" value={prepared.stockVault}/><ReviewFact label="Proceeds vault" value={prepared.proceedsVault}/><ReviewFact label="Commitment fingerprint" value={`${prepared.headCommitment.slice(0, 12)}…${prepared.headCommitment.slice(-8)}`}/><ReviewFact label="End date" value={prepared.expiresAt}/></dl><p className="mt-8 text-sm text-warning">Transaction simulation and Devnet Market reconciliation must succeed before funding can be requested.</p><button type="button" onClick={onBack} className="mt-6 min-h-11 border border-line-default px-4 text-sm text-text-primary">Back to edit</button></section>; }
function ReviewFact({ label, value }: { label: string; value: string }) { return <div className="flex flex-col gap-1 border-b border-line-subtle pb-3"><dt className="text-text-tertiary">{label}</dt><dd className="break-all font-mono text-text-primary">{value}</dd></div>; }
function DisconnectedState() { return <section className="mx-auto max-w-2xl border-y border-line-default py-8"><h1 className="text-2xl font-medium text-text-primary">Connect a Solana wallet to create a Sell Plan.</h1><Link href="/portfolio" className="mt-5 inline-flex min-h-11 items-center text-text-primary underline">Back to portfolio</Link></section>; }
function NoBalanceState() { return <section className="mx-auto max-w-2xl border-y border-line-default py-8"><h1 className="text-2xl font-medium text-text-primary">There isn&apos;t any supported stock available to commit from this wallet.</h1><Link href="/portfolio" className="mt-5 inline-flex min-h-11 items-center text-text-primary underline">Back to portfolio</Link></section>; }
function createDefaultStages(market: SellPlanMarket): DraftStage[] { const session = market.allowedSessions.includes('regular') ? 'regular' : market.allowedSessions[0]; return defaultPremiums.map((minPremiumBps, index) => ({ id: `stage-${index + 1}`, allocationBps: 2_500, minPremiumBps, allowedSessions: session ? [session] : [] })); }
function parsePercentageBasisPoints(value: string): number { if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) throw new Error('invalid percentage'); const [whole, fraction = ''] = value.split('.'); const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0')); if (result <= 0 || result > 10_000) throw new Error('invalid percentage'); return result; }
function sessionMask(sessions: readonly string[]): number { return sessions.reduce((mask, session) => mask | ({ regular: 1, preMarket: 2, postMarket: 4, overNight: 8 }[session] ?? 0), 0); }
function moveStage(stages: DraftStage[], setStages: (stages: DraftStage[]) => void, index: number, direction: -1 | 1) { const target = index + direction; if (target < 0 || target >= stages.length) return; const next = [...stages]; const source = next[index]; const destination = next[target]; if (!source || !destination) return; next[index] = destination; next[target] = source; setStages(next); }
function validateDraft({ holding, committedRawAmount, allocations, stages, expiry, market }: { holding: LoadedHolding | undefined; committedRawAmount: bigint | undefined; allocations: ReturnType<typeof allocateStageInventory> | undefined; stages: DraftStage[]; expiry: string; market: SellPlanMarket }): string | undefined { if (!holding || !committedRawAmount || committedRawAmount <= 0n || committedRawAmount > BigInt(holding.rawAmount)) return 'Enter an amount within your available holding.'; if (committedRawAmount > BigInt(holding.sourceRawAmount)) return 'Choose an amount available from one supported token account.'; if (!allocations) return 'Stage allocations must add up to 100.00%.'; if (allocations.some(stage => stage.rawQuantity < BigInt(market.minimumStageRawAmount))) return 'This Stage is too small for this Market. Increase its allocation.'; if (stages.some(stage => stage.minPremiumBps <= -10_000 || stage.allowedSessions.length === 0)) return 'Every Stage needs a valid minimum premium and at least one available market session.'; if (!expiry || new Date(expiry).getTime() <= Date.now()) return 'Choose an end date in the future.'; return undefined; }
