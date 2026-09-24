import 'server-only';

import { address, createSolanaRpc, getBase58Encoder } from '@solana/kit';
import {
  fetchBatchOutcome,
  fetchSaleReceipt,
  fetchSaleReceiptAtAddress,
  type PublicSettlementReceipt,
} from '@bazo/sdk';
import { getEnvironment } from './env';
import { readPublicSellPlan } from './plans';

export type ConfirmedSale = {
  receipt: PublicSettlementReceipt;
  signature: string | null;
};

export async function readSaleForPlan(
  plan: string,
  stageIndex: number,
): Promise<ConfirmedSale | null> {
  if (stageIndex < 0) return null;
  const env = getEnvironment();
  const receipt = await fetchSaleReceipt({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    plan: address(plan),
    stageIndex,
  });
  if (!receipt) return null;
  const outcome = await fetchBatchOutcome({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    batch: receipt.batch,
  });
  if (
    !outcome ||
    outcome.receipt !== receipt.address ||
    outcome.plan !== receipt.plan
  )
    return null;
  return { receipt, signature: await findSaleSignature(receipt) };
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
  return { receipt, signature: await findSaleSignature(receipt) };
}

async function findSaleSignature(
  receipt: PublicSettlementReceipt,
): Promise<string | null> {
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
    if (found) return candidate.signature;
  }
  return null;
}
