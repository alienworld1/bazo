import 'server-only';

import {
  deriveMarketAddress,
  derivePlanAddresses,
  derivePlanReservationAddress,
  fetchPlanReservation,
} from '@bazo/sdk';
import {
  address,
  createSolanaRpc,
  isAddress,
  parseBase64RpcAccount,
} from '@solana/kit';
import { decodeToken } from '@solana-program/token-2022';
import { getEnvironment } from './env';
import {
  decodePublicSellPlan,
  PLAN_ACCOUNT_DATA_LENGTH,
  type PublicSellPlan,
} from '@/lib/plan-projection';

export type { PublicSellPlan } from '@/lib/plan-projection';

export type VerifiedPublicSellPlan = PublicSellPlan & {
  stockVaultMint: string;
  stockVaultOwner: string;
  stockVaultRawAmount: string;
  proceedsVaultRawAmount: string;
  proceedsVaultMint: string;
  quoteDecimals: number;
  reservation: { address: string; batch: string; lockDeadline: string } | null;
};

export async function readPublicSellPlan(
  planAddress: string,
): Promise<VerifiedPublicSellPlan | null> {
  if (!isAddress(planAddress)) return null;
  const env = getEnvironment();
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
  const account = parseBase64RpcAccount(
    address(planAddress),
    (
      await rpc
        .getAccountInfo(address(planAddress), {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send()
    ).value,
  );
  if (
    !account.exists ||
    account.programAddress !== address(env.BAZO_PROGRAM_ID) ||
    account.data.length !== PLAN_ACCOUNT_DATA_LENGTH
  ) {
    return null;
  }

  const plan = decodePublicSellPlan(account.data, planAddress);
  if (!plan || !isAddress(plan.stockVault) || !isAddress(plan.proceedsVault)) {
    return null;
  }
  const expected = await derivePlanAddresses({
    programAddress: address(env.BAZO_PROGRAM_ID),
    owner: address(plan.owner),
    market: address(plan.market),
    planNonce: BigInt(plan.planNonce),
  });
  const expectedMarket = await deriveMarketAddress(
    address(env.BAZO_PROGRAM_ID),
    {
      stockMint: address(env.BAZO_STOCK_MINT),
      quoteMint: address(env.BAZO_QUOTE_MINT),
    },
  );
  if (
    expected.plan !== address(planAddress) ||
    expected.stockVault !== address(plan.stockVault) ||
    expected.proceedsVault !== address(plan.proceedsVault) ||
    expectedMarket !== address(plan.market) ||
    plan.status === 'unknown'
  )
    return null;
  const reservationAddress = await derivePlanReservationAddress(
    address(env.BAZO_PROGRAM_ID),
    address(planAddress),
    plan.currentStageIndex,
  );
  const reservationAccount = (
    await rpc
      .getAccountInfo(reservationAddress, {
        encoding: 'base64',
        commitment: 'confirmed',
      })
      .send()
  ).value;
  const reservation = reservationAccount
    ? await fetchPlanReservation({
        rpcUrl: env.SOLANA_RPC_URL,
        programAddress: address(env.BAZO_PROGRAM_ID),
        plan: address(planAddress),
        stageIndex: plan.currentStageIndex,
      })
    : null;
  if (reservationAccount && !reservation)
    throw new Error('plan reservation verification failed');
  const [stockVaultAccount, proceedsVaultAccount, quoteBalance] =
    await Promise.all([
      rpc
        .getAccountInfo(address(plan.stockVault), {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send(),
      rpc
        .getAccountInfo(address(plan.proceedsVault), {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send(),
      rpc
        .getTokenAccountBalance(address(plan.proceedsVault), {
          commitment: 'confirmed',
        })
        .send(),
    ]);
  const stockVault = parseBase64RpcAccount(
    address(plan.stockVault),
    stockVaultAccount.value,
  );
  const proceedsVault = parseBase64RpcAccount(
    address(plan.proceedsVault),
    proceedsVaultAccount.value,
  );
  if (!stockVault.exists || !proceedsVault.exists)
    throw new Error('plan vault unavailable');

  const decodedStockVault = decodeToken(stockVault);
  const decodedProceedsVault = decodeToken(proceedsVault);
  if (
    decodedStockVault.data.owner !== address(plan.address) ||
    decodedProceedsVault.data.owner !== address(plan.address) ||
    BigInt(plan.remainingRawInventory) + BigInt(plan.soldRawInventory) >
      BigInt(plan.initialRawInventory) ||
    stockVault.programAddress !== address(env.BAZO_STOCK_TOKEN_PROGRAM) ||
    proceedsVault.programAddress !== address(env.BAZO_QUOTE_TOKEN_PROGRAM) ||
    decodedStockVault.data.mint !== address(env.BAZO_STOCK_MINT) ||
    decodedProceedsVault.data.mint !== address(env.BAZO_QUOTE_MINT) ||
    decodedStockVault.data.amount.toString() !== plan.remainingRawInventory ||
    BigInt(plan.claimedQuoteAmount) > BigInt(plan.accruedQuoteAmount) ||
    decodedProceedsVault.data.amount !==
      BigInt(plan.accruedQuoteAmount) - BigInt(plan.claimedQuoteAmount) ||
    quoteBalance.value.amount !== decodedProceedsVault.data.amount.toString()
  )
    throw new Error('plan vault accounting mismatch');
  return {
    ...plan,
    stockVaultMint: decodedStockVault.data.mint,
    stockVaultOwner: decodedStockVault.data.owner,
    stockVaultRawAmount: decodedStockVault.data.amount.toString(),
    proceedsVaultRawAmount: decodedProceedsVault.data.amount.toString(),
    proceedsVaultMint: decodedProceedsVault.data.mint,
    quoteDecimals: quoteBalance.value.decimals,
    reservation: reservation
      ? {
          address: reservation.address,
          batch: reservation.batch,
          lockDeadline: reservation.lockDeadline,
        }
      : null,
  };
}
