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
import { currentScaledUiMultiplier } from '@/lib/scaled-ui-multiplier';
import { aggregateRawAmounts, formatDisplayAmount } from '@/lib/token-amounts';
import { readChainUnixTimestamp } from './buy-requests';
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

  const validAccounts = tokenAccounts.value.map(account => {
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
      return { address: account.pubkey, rawAmount: decoded.data.amount.toString() };
    });
  const rawAmount = aggregateRawAmounts(validAccounts.map(account => account.rawAmount));
  const source = validAccounts.reduce<(typeof validAccounts)[number] | undefined>(
    (largest, account) =>
      !largest || BigInt(account.rawAmount) > BigInt(largest.rawAmount)
        ? account
        : largest,
    undefined,
  );
  const scaledExtension = extensions.find(
    extension => extension.__kind === 'ScaledUiAmountConfig',
  );
  const multiplier =
    scaledExtension?.__kind === 'ScaledUiAmountConfig'
      ? currentScaledUiMultiplier(
          scaledExtension,
          await readChainUnixTimestamp(),
        )
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
    sourceTokenAccount: source?.address ?? null,
    sourceRawAmount: source?.rawAmount ?? '0',
    slot: Number(tokenAccounts.context.slot),
  };
}

export async function readStockMultiplier(market: MarketConfig): Promise<string> {
  const rpc = createSolanaRpc(getEnvironment().SOLANA_RPC_URL);
  const mint = await fetchMint(rpc, address(market.stockMint));
  if (mint.programAddress !== address(market.stockTokenProgram) || mint.data.decimals !== market.tokenDecimals)
    throw new Error('stock mint mismatch');
  const extensions = isSome(mint.data.extensions) ? mint.data.extensions.value : [];
  if (extensions.some(extension => !market.supportedStockExtensions.includes(extension.__kind)))
    throw new Error('unsupported_mint_extension');
  const scaled = extensions.find(extension => extension.__kind === 'ScaledUiAmountConfig');
  return scaled?.__kind === 'ScaledUiAmountConfig'
    ? currentScaledUiMultiplier(scaled, await readChainUnixTimestamp())
    : '1';
}

export async function readSpendableQuoteBalance(
  market: MarketConfig,
  owner: string,
): Promise<{ rawAmount: string; sourceTokenAccount: string | null; decimals: number }> {
  if (!isAddress(owner)) throw new Error('invalid_owner');
  const rpc = createSolanaRpc(getEnvironment().SOLANA_RPC_URL);
  const mintAddress = address(market.quoteMint);
  const [mintAccount, tokenAccounts] = await Promise.all([
    fetchMint(rpc, mintAddress),
    rpc.getTokenAccountsByOwner(address(owner), { mint: mintAddress }, { encoding: 'base64' }).send(),
  ]);
  if (mintAccount.programAddress !== address(market.quoteTokenProgram)) throw new Error('mint_program_mismatch');
  const extensions = isSome(mintAccount.data.extensions) ? mintAccount.data.extensions.value : [];
  if (extensions.length > 0) throw new Error('unsupported_quote_extension');
  const accounts = tokenAccounts.value.map(account => {
    const decoded = decodeToken(parseBase64RpcAccount(account.pubkey, account.account));
    if (decoded.programAddress !== address(market.quoteTokenProgram) || decoded.data.mint !== mintAddress || decoded.data.owner !== address(owner)) throw new Error('token_account_mismatch');
    return { address: account.pubkey, rawAmount: decoded.data.amount.toString() };
  });
  const source = accounts.reduce<(typeof accounts)[number] | undefined>((largest, current) => !largest || BigInt(current.rawAmount) > BigInt(largest.rawAmount) ? current : largest, undefined);
  return { rawAmount: source?.rawAmount ?? '0', sourceTokenAccount: source?.address ?? null, decimals: mintAccount.data.decimals };
}
