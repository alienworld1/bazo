import 'server-only';
import {
  address,
  createSolanaRpc,
  isAddress,
  isSome,
  parseBase64RpcAccount,
} from '@solana/kit';
import { decodeToken, fetchMint } from '@solana-program/token-2022';
import type { MarketConfig, SupportedHolding } from '@/lib/markets';
import { aggregateRawAmounts, formatDisplayAmount } from '@/lib/token-amounts';
import { getEnvironment } from './env';

export async function readSupportedHolding(
  market: MarketConfig,
  owner: string,
): Promise<SupportedHolding> {
  if (!isAddress(owner)) throw new Error('invalid_owner');
  const rpc = createSolanaRpc(getEnvironment().SOLANA_RPC_URL);
  const mintAddress = address(market.stockMint);
  const [mintAccount, tokenAccounts] = await Promise.all([
    fetchMint(rpc, mintAddress),
    rpc
      .getTokenAccountsByOwner(
        address(owner),
        { mint: mintAddress },
        { encoding: 'base64' },
      )
      .send(),
  ]);

  if (mintAccount.programAddress !== address(market.stockTokenProgram)) {
    throw new Error('mint_program_mismatch');
  }
  if (mintAccount.data.decimals !== market.tokenDecimals) {
    throw new Error('mint_decimals_mismatch');
  }

  const extensions = isSome(mintAccount.data.extensions)
    ? mintAccount.data.extensions.value
    : [];
  const extensionNames = extensions.map(extension => extension.__kind);
  if (
    extensionNames.some(
      extension => !market.supportedStockExtensions.includes(extension),
    )
  ) {
    throw new Error('unsupported_mint_extension');
  }

  const rawAmount = aggregateRawAmounts(
    tokenAccounts.value.map(account => {
      const decoded = decodeToken(
        parseBase64RpcAccount(account.pubkey, account.account),
      );
      if (
        decoded.programAddress !== address(market.stockTokenProgram) ||
        decoded.data.mint !== mintAddress ||
        decoded.data.owner !== address(owner)
      ) {
        throw new Error('token_account_mismatch');
      }
      return decoded.data.amount.toString();
    }),
  );
  const scaledExtension = extensions.find(
    extension => extension.__kind === 'ScaledUiAmountConfig',
  );
  const multiplier =
    scaledExtension?.__kind === 'ScaledUiAmountConfig'
      ? String(scaledExtension.multiplier)
      : '1';

  return {
    owner,
    marketId: market.id,
    rawAmount,
    displayAmount: formatDisplayAmount(
      rawAmount,
      mintAccount.data.decimals,
      multiplier,
    ),
    displaySymbol: market.symbol,
    decimals: mintAccount.data.decimals,
    multiplierContext: scaledExtension ? multiplier : null,
    slot: Number(tokenAccounts.context.slot),
  };
}
