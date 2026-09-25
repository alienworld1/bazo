import 'server-only';

import { address, createSolanaRpc, getBase58Encoder } from '@solana/kit';
import {
  fetchBatchOutcome,
  fetchSaleReceipt,
  fetchSaleReceiptAtAddress,
  type PublicSettlementReceipt,
} from '@bazo/sdk';
import { getEnvironment } from './env';
import { readPublicSellPlan, type VerifiedPublicSellPlan } from './plans';

export type ConfirmedSale = {
  receipt: PublicSettlementReceipt;
  signature: string | null;
  occurredAtUnix?: string | null;
};

export async function readSalesForPlan(plan: VerifiedPublicSellPlan) {
  const stageCount = plan.currentStageIndex;
  if (!Number.isSafeInteger(stageCount) || stageCount < 0 || stageCount > 6)
    throw new Error('invalid stage count');
  const firstResults = await Promise.allSettled(
    Array.from({ length: stageCount }, (_, index) =>
      readSaleForPlan(plan, index),
    ),
  );
  const results = await Promise.all(
    firstResults.map(async (result, index) => {
      if (result.status === 'fulfilled' && result.value) return result;
      try {
        return {
          status: 'fulfilled' as const,
          value: await readSaleForPlan(plan, index),
        };
      } catch (reason) {
        return { status: 'rejected' as const, reason };
      }
    }),
  );
  return results.map((result, index) => ({
    stageIndex: index,
    sale: result.status === 'fulfilled' ? result.value : null,
    unavailable:
      result.status === 'rejected' ||
      (result.status === 'fulfilled' && result.value === null),
  }));
}

export async function readSaleForPlan(
  plan: VerifiedPublicSellPlan,
  stageIndex: number,
): Promise<ConfirmedSale | null> {
  if (stageIndex < 0 || plan.currentStageIndex <= stageIndex) return null;
  const env = getEnvironment();
  const receipt = await fetchSaleReceipt({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    plan: address(plan.address),
    stageIndex,
  });
  if (!receipt) return null;
  if (receipt.plan !== plan.address || receipt.stageIndex !== stageIndex)
    return null;
  const outcome = await fetchBatchOutcome({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    batch: receipt.batch,
  });
  if (
    !outcome ||
    outcome.receipt !== receipt.address ||
    outcome.plan !== receipt.plan ||
    outcome.batch !== receipt.batch
  )
    return null;
  const transaction = await findSaleSignature(receipt).catch(() => null);
  return {
    receipt,
    signature: transaction?.signature ?? null,
    occurredAtUnix: transaction?.occurredAtUnix ?? receipt.executedAt,
  };
}

export async function readSaleForBatch(
  batch: string,
): Promise<ConfirmedSale | null> {
  const env = getEnvironment();
  const outcome = await fetchBatchOutcome({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    batch: address(batch),
  });
  if (!outcome) return null;
  const [plan, receipt] = await Promise.all([
    readPublicSellPlan(outcome.plan),
    fetchSaleReceiptAtAddress({
      rpcUrl: env.SOLANA_RPC_URL,
      programAddress: address(env.BAZO_PROGRAM_ID),
      receipt: outcome.receipt,
    }),
  ]);
  if (
    !plan ||
    !receipt ||
    receipt.batch !== outcome.batch ||
    receipt.plan !== plan.address ||
    plan.currentStageIndex <= receipt.stageIndex
  )
    return null;
  const transaction = await findSaleSignature(receipt).catch(() => null);
  return {
    receipt,
    signature: transaction?.signature ?? null,
    occurredAtUnix: transaction?.occurredAtUnix ?? receipt.executedAt,
  };
}

async function findSaleSignature(
  receipt: PublicSettlementReceipt,
): Promise<{ signature: string; occurredAtUnix: string | null } | null> {
  const env = getEnvironment();
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
  const signatures = await rpc
    .getSignaturesForAddress(receipt.address, {
      limit: 32,
      commitment: 'confirmed',
    })
    .send();
  const discriminator = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('global:settle_stage'),
    ),
  ).slice(0, 8);
  const decoder = getBase58Encoder();
  for (const candidate of signatures) {
    if (candidate.err) continue;
    const transaction = await rpc
      .getTransaction(candidate.signature, {
        encoding: 'json',
        maxSupportedTransactionVersion: 1,
        commitment: 'confirmed',
      })
      .send();
    if (!transaction || transaction.meta?.err) continue;
    const keys = transaction.transaction.message.accountKeys;
    const found = transaction.transaction.message.instructions.some(
      instruction => {
        if (
          keys[instruction.programIdIndex] !== env.BAZO_PROGRAM_ID ||
          keys[instruction.accounts[3]] !== receipt.plan ||
          keys[instruction.accounts[5]] !== receipt.batch ||
          keys[instruction.accounts[6]] !== receipt.address
        )
          return false;
        const data = decoder.encode(instruction.data);
        return discriminator.every((value, index) => data[index] === value);
      },
    );
    if (found)
      return {
        signature: candidate.signature,
        occurredAtUnix: transaction.blockTime?.toString() ?? null,
      };
  }
  return null;
}
