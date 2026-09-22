import 'server-only';
import { address, createSolanaRpc, isAddress, parseBase64RpcAccount } from '@solana/kit';
import { decodeToken } from '@solana-program/token-2022';
import { BUY_REQUEST_ACCOUNT_DATA_LENGTH, decodePublicBuyRequest, type PublicBuyRequest } from '@/lib/buy-request-projection';
import { getEnvironment } from './env';

export type VerifiedBuyRequest = PublicBuyRequest & { escrowRawAmount: string; escrowMint: string; escrowOwner: string };
export async function readBuyRequest(requestAddress: string): Promise<VerifiedBuyRequest | null> {
  if (!isAddress(requestAddress)) return null; const env = getEnvironment(); const rpc = createSolanaRpc(env.SOLANA_RPC_URL); const account = parseBase64RpcAccount(address(requestAddress), (await rpc.getAccountInfo(address(requestAddress), { encoding: 'base64' }).send()).value);
  if (!account.exists || account.programAddress !== address(env.BAZO_PROGRAM_ID) || account.data.length !== BUY_REQUEST_ACCOUNT_DATA_LENGTH) return null;
  const request = decodePublicBuyRequest(account.data, requestAddress); if (!request || !isAddress(request.escrow)) return null;
  const escrow = parseBase64RpcAccount(address(request.escrow), (await rpc.getAccountInfo(address(request.escrow), { encoding: 'base64' }).send()).value); if (!escrow.exists) return null;
  try { const token = decodeToken(escrow); return { ...request, escrowRawAmount: token.data.amount.toString(), escrowMint: token.data.mint, escrowOwner: token.data.owner }; } catch { return null; }
}
