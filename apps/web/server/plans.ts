import 'server-only';

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
  const [stockVaultAccount, proceedsVaultAccount, quoteBalance] =
    await Promise.all([
      rpc
        .getAccountInfo(address(plan.stockVault), { encoding: 'base64' })
        .send(),
      rpc
        .getAccountInfo(address(plan.proceedsVault), { encoding: 'base64' })
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
  if (!stockVault.exists || !proceedsVault.exists) return null;

  try {
    const decodedStockVault = decodeToken(stockVault);
    const decodedProceedsVault = decodeToken(proceedsVault);
    if (
      decodedStockVault.data.owner !== address(plan.address) ||
      decodedProceedsVault.data.owner !== address(plan.address) ||
      decodedStockVault.data.amount.toString() !== plan.remainingRawInventory ||
      quoteBalance.value.amount !== decodedProceedsVault.data.amount.toString()
    )
      return null;
    return {
      ...plan,
      stockVaultMint: decodedStockVault.data.mint,
      stockVaultOwner: decodedStockVault.data.owner,
      stockVaultRawAmount: decodedStockVault.data.amount.toString(),
      proceedsVaultRawAmount: decodedProceedsVault.data.amount.toString(),
      proceedsVaultMint: decodedProceedsVault.data.mint,
      quoteDecimals: quoteBalance.value.decimals,
    };
  } catch {
    return null;
  }
}
