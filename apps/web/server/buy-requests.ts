import 'server-only';
import { address, createSolanaRpc, parseBase64RpcAccount } from '@solana/kit';
import { decodeToken } from '@solana-program/token-2022';
import {
  deriveMarketAddress,
  fetchBuyRequest,
  type PublicBuyRequest,
} from '@bazo/sdk';
import { getEnvironment } from './env';

export type VerifiedBuyRequest = PublicBuyRequest & {
  escrowRawAmount: string;
  escrowMint: string;
  escrowOwner: string;
};
export async function readChainUnixTimestamp(): Promise<bigint> {
  const rpc = createSolanaRpc(getEnvironment().SOLANA_RPC_URL);
  const clockAddress = address('SysvarC1ock11111111111111111111111111111111');
  const account = parseBase64RpcAccount(
    clockAddress,
    (await rpc.getAccountInfo(clockAddress, { encoding: 'base64' }).send())
      .value,
  );
  if (
    !account.exists ||
    account.data.length !== 40 ||
    account.programAddress !==
      address('Sysvar1111111111111111111111111111111111111')
  )
    throw new Error('chain clock unavailable');
  return new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  ).getBigInt64(32, true);
}
export async function readBuyRequest(
  requestAddress: string,
): Promise<VerifiedBuyRequest | null> {
  const env = getEnvironment();
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
  const request = await fetchBuyRequest({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    requestAddress,
  });
  if (!request) return null;
  const expectedMarket = await deriveMarketAddress(
    address(env.BAZO_PROGRAM_ID),
    {
      stockMint: address(env.BAZO_STOCK_MINT),
      quoteMint: address(env.BAZO_QUOTE_MINT),
    },
  );
  if (expectedMarket !== address(request.market)) return null;
  const escrow = parseBase64RpcAccount(
    address(request.escrow),
    (
      await rpc
        .getAccountInfo(address(request.escrow), { encoding: 'base64' })
        .send()
    ).value,
  );
  if (!escrow.exists) return null;
  try {
    const token = decodeToken(escrow);
    if (
      token.data.mint !== address(env.BAZO_QUOTE_MINT) ||
      token.data.owner !== address(requestAddress) ||
      token.programAddress !== address(env.BAZO_QUOTE_TOKEN_PROGRAM)
    )
      return null;
    const remaining =
      BigInt(request.maxQuoteAmount) - BigInt(request.spentQuoteAmount);
    if (
      remaining < 0n ||
      BigInt(request.refundableQuoteAmount) > remaining ||
      (request.status === 'active' || request.status === 'filled'
        ? token.data.amount !== remaining
        : token.data.amount !== 0n)
    ) {
      throw new Error('request escrow accounting mismatch');
    }
    return {
      ...request,
      escrowRawAmount: token.data.amount.toString(),
      escrowMint: token.data.mint,
      escrowOwner: token.data.owner,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'request escrow accounting mismatch'
    )
      throw error;
    return null;
  }
}
