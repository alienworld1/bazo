import 'server-only';

import { address, createSolanaRpc, isAddress } from '@solana/kit';
import { BUY_REQUEST_ACCOUNT_DATA_LENGTH } from '@bazo/sdk';
import { getEnvironment } from './env';
import { readBuyRequest } from './buy-requests';
import { getEnabledMarkets } from './market-registry';
import { readPublicSellPlan } from './plans';
import { readStockMultiplier } from './holdings';
import { PLAN_ACCOUNT_DATA_LENGTH } from '@/lib/plan-projection';

const MAX_ADDRESSES = 40;

export async function readWalletPositions(owner: string) {
  if (!isAddress(owner)) throw new Error('invalid_owner');
  const env = getEnvironment();
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
  const program = address(env.BAZO_PROGRAM_ID);
  const find = (size: number) =>
    rpc
      .getProgramAccounts(program, {
        encoding: 'base64',
        filters: [
          { dataSize: BigInt(size) },
          { memcmp: { offset: 10n, bytes: owner, encoding: 'base58' } },
        ],
        commitment: 'confirmed',
      })
      .send();
  const [planAccounts, requestAccounts] = await Promise.all([
    find(PLAN_ACCOUNT_DATA_LENGTH),
    find(BUY_REQUEST_ACCOUNT_DATA_LENGTH),
  ]);
  const markets = getEnabledMarkets();
  const multipliers = Object.fromEntries(
    await Promise.all(
      markets.map(
        async market => [market.id, await readStockMultiplier(market)] as const,
      ),
    ),
  );
  const planAddresses = planAccounts.map(item => item.pubkey);
  const requestAddresses = requestAccounts.map(item => item.pubkey);
  const truncated =
    planAddresses.length > MAX_ADDRESSES ||
    requestAddresses.length > MAX_ADDRESSES;
  const planResults = await verifyCandidates(
    planAddresses.slice(0, MAX_ADDRESSES),
    readPublicSellPlan,
  );
  const requestResults = await verifyCandidates(
    requestAddresses.slice(0, MAX_ADDRESSES),
    readBuyRequest,
  );
  const plans = planResults.flatMap(result => {
    if (result.status !== 'fulfilled' || !result.value) return [];
    const plan = result.value;
    return plan.owner === owner &&
      markets.some(
        market =>
          market.stockMint === plan.stockVaultMint &&
          market.quoteMint === plan.proceedsVaultMint,
      )
      ? [plan]
      : [];
  });
  const requests = requestResults.flatMap(result => {
    if (result.status !== 'fulfilled' || !result.value) return [];
    const request = result.value;
    return request.buyer === owner &&
      markets.some(market => market.quoteMint === request.escrowMint)
      ? [request]
      : [];
  });
  return {
    plans,
    requests,
    multipliers,
    partial:
      truncated ||
      planResults.some(
        result => result.status === 'rejected' || !result.value,
      ) ||
      requestResults.some(
        result => result.status === 'rejected' || !result.value,
      ),
  };
}

async function verifyCandidates<T>(
  addresses: readonly string[],
  read: (address: string) => Promise<T | null>,
): Promise<PromiseSettledResult<T | null>[]> {
  const results: PromiseSettledResult<T | null>[] = [];
  for (let index = 0; index < addresses.length; index += 2) {
    const chunk = addresses.slice(index, index + 2);
    results.push(
      ...(await Promise.allSettled(
        chunk.map(async candidate => {
          try {
            const first = await read(candidate);
            return first ?? (await read(candidate));
          } catch {
            return read(candidate);
          }
        }),
      )),
    );
  }
  return results;
}
