import 'server-only';
import { address, createSolanaRpc, isAddress, parseBase64RpcAccount } from '@solana/kit';
import { decodeToken } from '@solana-program/token-2022';
import { deriveBuyRequestAddresses, deriveMarketAddress } from '@bazo/sdk';
import { BUY_REQUEST_ACCOUNT_DATA_LENGTH, decodePublicBuyRequest, type PublicBuyRequest } from '@/lib/buy-request-projection';
import { getEnvironment } from './env';

export type VerifiedBuyRequest = PublicBuyRequest & { escrowRawAmount: string; escrowMint: string; escrowOwner: string };
export async function readBuyRequest(requestAddress: string): Promise<VerifiedBuyRequest | null> {
  if (!isAddress(requestAddress)) return null; const env = getEnvironment(); const rpc = createSolanaRpc(env.SOLANA_RPC_URL); const account = parseBase64RpcAccount(address(requestAddress), (await rpc.getAccountInfo(address(requestAddress), { encoding: 'base64' }).send()).value);
  if (!account.exists || account.programAddress !== address(env.BAZO_PROGRAM_ID) || account.data.length !== BUY_REQUEST_ACCOUNT_DATA_LENGTH) return null;
  const request = decodePublicBuyRequest(account.data, requestAddress); if (!request || !isAddress(request.escrow)) return null;
  const [expectedAddresses, expectedMarket] = await Promise.all([
    deriveBuyRequestAddresses({ programAddress: address(env.BAZO_PROGRAM_ID), buyer: address(request.buyer), requestNonce: BigInt(request.requestNonce) }),
    deriveMarketAddress(address(env.BAZO_PROGRAM_ID), { stockMint: address(env.BAZO_STOCK_MINT), quoteMint: address(env.BAZO_QUOTE_MINT) }),
  ]);
  if (expectedAddresses.request !== address(requestAddress) || expectedAddresses.escrow !== address(request.escrow) || expectedMarket !== address(request.market)) return null;
  const escrow = parseBase64RpcAccount(address(request.escrow), (await rpc.getAccountInfo(address(request.escrow), { encoding: 'base64' }).send()).value); if (!escrow.exists) return null;
  try { const token = decodeToken(escrow); if (token.data.mint !== address(env.BAZO_QUOTE_MINT) || token.data.owner !== address(requestAddress) || token.programAddress !== address(env.BAZO_QUOTE_TOKEN_PROGRAM)) return null; return { ...request, escrowRawAmount: token.data.amount.toString(), escrowMint: token.data.mint, escrowOwner: token.data.owner }; } catch { return null; }
}
