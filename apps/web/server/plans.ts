import 'server-only';

import {
  address,
  createSolanaRpc,
  isAddress,
  parseBase64RpcAccount,
} from '@solana/kit';
import { getEnvironment } from './env';
import {
  decodePublicSellPlan,
  PLAN_ACCOUNT_DATA_LENGTH,
  type PublicSellPlan,
} from '@/lib/plan-projection';

export type { PublicSellPlan } from '@/lib/plan-projection';

export async function readPublicSellPlan(
  planAddress: string,
): Promise<PublicSellPlan | null> {
  if (!isAddress(planAddress)) return null;
  const env = getEnvironment();
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
  const account = parseBase64RpcAccount(
    address(planAddress),
    (await rpc
      .getAccountInfo(address(planAddress), { encoding: 'base64' })
      .send()).value,
  );
  if (
    !account.exists ||
    account.programAddress !== address(env.BAZO_PROGRAM_ID) ||
    account.data.length !== PLAN_ACCOUNT_DATA_LENGTH
  ) {
    return null;
  }

  return decodePublicSellPlan(account.data, planAddress);
}
