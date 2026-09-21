'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { address } from '@solana/kit';
import {
  buildCommitmentChain,
  randomPlanNonce,
  randomSalt,
  toHex,
} from '@bazo/plan-crypto';
import {
  deriveMarketAddress,
  derivePlanAddresses,
  prepareSellPlan,
} from '@bazo/sdk';
import { allocateStageInventory } from '@/lib/stage-allocation';
import {
  formatDisplayAmount,
  parseDisplayAmountToRaw,
} from '@/lib/token-amounts';
import { solanaClient } from '@/components/solana-client';
import { StageDraftCard } from './stage-draft-card';
import { StageEditor } from './stage-editor';
import { AmountControl } from './amount-control';
import { DisconnectedSellPlanState } from './disconnected-sell-plan-state';
import { EmptySellPlanState } from './empty-sell-plan-state';
import { PreparedSellPlanReview } from './prepared-sell-plan-review';
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
  const router = useRouter();
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
  const [transactionStatus, setTransactionStatus] = useState<string>();
  const [transactionError, setTransactionError] = useState<string>();

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
        marketAddress,
        planNonce: nonce.toString(),
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
        expiresAtUnix: String(Math.floor(new Date(expiry).getTime() / 1_000)),
        headCommitmentBytes: chain.headCommitment,
      });
    } finally {
      setPreparing(false);
    }
  };

  const sealAndFund = async () => {
    if (!prepared || !owner || !holding?.sourceTokenAccount) return;
    setTransactionError(undefined);
    setTransactionStatus('Checking transaction…');
    try {
      const preparedTransaction = await prepareSellPlan({
        programAddress: address(programAddress),
        owner: address(owner),
        sourceStockAccount: address(holding.sourceTokenAccount),
        market: address(prepared.marketAddress),
        stockMint: address(market.stockMint),
        quoteMint: address(market.quoteMint),
        stockTokenProgram: address(market.stockTokenProgram),
        quoteTokenProgram: address(market.quoteTokenProgram),
        planNonce: BigInt(prepared.planNonce),
        currentStageCommitment: prepared.headCommitmentBytes,
        initialRawInventory: BigInt(prepared.rawAmount),
        expiresAt: BigInt(prepared.expiresAtUnix),
      });
      setTransactionStatus('Awaiting wallet approval…');
      const result = await solanaClient.sendTransaction([preparedTransaction.instruction]);
      setTransactionStatus('Reconciling your funded Plan…');
      const signature = result.context.signature;
      const response = await fetch(`/api/sell-plans/${prepared.plan}`, {
        cache: 'no-store',
      });
      const plan = response.ok ? await response.json() : undefined;
      const reconciled = isPreparedPlanReconciled({
        plan,
        prepared,
        owner,
        stockMint: market.stockMint,
      });
      const reconciliation = reconciled ? 'confirmed' : 'mismatch';
      router.replace(
        `/sell-plans/${prepared.plan}?signature=${signature}&reconciliation=${reconciliation}`,
      );
    } catch (error) {
      setTransactionStatus(undefined);
      setTransactionError(mapTransactionError(error));
    }
  };

  if (!connected) {
    return <DisconnectedSellPlanState />;
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
    return <EmptySellPlanState />;
  }
  if (prepared) {
    return <PreparedSellPlanReview prepared={prepared} onBack={() => setPrepared(undefined)} onSeal={() => void sealAndFund()} status={transactionStatus} error={transactionError} />;
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

function createDefaultStages(market: SellPlanMarket): DraftStage[] { const session = market.allowedSessions.includes('regular') ? 'regular' : market.allowedSessions[0]; return defaultPremiums.map((minPremiumBps, index) => ({ id: `stage-${index + 1}`, allocationBps: 2_500, minPremiumBps, allowedSessions: session ? [session] : [] })); }
function parsePercentageBasisPoints(value: string): number { if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) throw new Error('invalid percentage'); const [whole, fraction = ''] = value.split('.'); const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0')); if (result <= 0 || result > 10_000) throw new Error('invalid percentage'); return result; }
function sessionMask(sessions: readonly string[]): number { return sessions.reduce((mask, session) => mask | ({ regular: 1, preMarket: 2, postMarket: 4, overNight: 8 }[session] ?? 0), 0); }
function moveStage(stages: DraftStage[], setStages: (stages: DraftStage[]) => void, index: number, direction: -1 | 1) { const target = index + direction; if (target < 0 || target >= stages.length) return; const next = [...stages]; const source = next[index]; const destination = next[target]; if (!source || !destination) return; next[index] = destination; next[target] = source; setStages(next); }
function validateDraft({ holding, committedRawAmount, allocations, stages, expiry, market }: { holding: LoadedHolding | undefined; committedRawAmount: bigint | undefined; allocations: ReturnType<typeof allocateStageInventory> | undefined; stages: DraftStage[]; expiry: string; market: SellPlanMarket }): string | undefined { if (!holding || !committedRawAmount || committedRawAmount <= 0n || committedRawAmount > BigInt(holding.rawAmount)) return 'Enter an amount within your available holding.'; if (committedRawAmount > BigInt(holding.sourceRawAmount)) return 'Choose an amount available from one supported token account.'; if (!allocations) return 'Stage allocations must add up to 100.00%.'; if (allocations.some(stage => stage.rawQuantity < BigInt(market.minimumStageRawAmount))) return 'This Stage is too small for this Market. Increase its allocation.'; if (stages.some(stage => stage.minPremiumBps <= -10_000 || stage.allowedSessions.length === 0)) return 'Every Stage needs a valid minimum premium and at least one available market session.'; if (!expiry || new Date(expiry).getTime() <= Date.now()) return 'Choose an end date in the future.'; return undefined; }
function mapTransactionError(error: unknown): string { const message = error instanceof Error ? error.message.toLowerCase() : ''; if (message.includes('reject') || message.includes('cancel')) return 'Transaction canceled. Your Plan is still a draft and nothing moved.'; if (message.includes('insufficient')) return 'This Plan can’t be funded as prepared. Nothing moved. Refresh the details and try again.'; return 'We couldn’t confirm the transaction. Don’t submit again yet—we’re checking Solana for your Plan.'; }
function isPreparedPlanReconciled({ plan, prepared, owner, stockMint }: { plan: unknown; prepared: PreparedSellPlan; owner: string; stockMint: string }): boolean { if (!plan || typeof plan !== 'object') return false; const value = plan as Record<string, unknown>; return value.owner === owner && value.market === prepared.marketAddress && value.stockVault === prepared.stockVault && value.proceedsVault === prepared.proceedsVault && value.initialRawInventory === prepared.rawAmount && value.remainingRawInventory === prepared.rawAmount && value.stockVaultMint === stockMint && value.stockVaultOwner === prepared.plan && value.stockVaultRawAmount === prepared.rawAmount && value.proceedsVaultRawAmount === '0' && value.currentStageIndex === 0 && value.currentCommitment === prepared.headCommitment && value.expiresAtUnix === prepared.expiresAtUnix && value.status === 'active'; }
