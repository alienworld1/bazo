export function quoteCapFromReference({
  targetRawQuantity,
  stockDecimals,
  stockMultiplier = '1',
  quoteDecimals,
  referencePrice,
  referenceExponent,
  premiumBps,
}: {
  targetRawQuantity: bigint;
  stockDecimals: number;
  stockMultiplier?: string;
  quoteDecimals: number;
  referencePrice: string;
  referenceExponent: number;
  premiumBps: number;
}): bigint {
  if (
    !/^\d+$/.test(referencePrice) ||
    !/^\d+(\.\d+)?$/.test(stockMultiplier) ||
    targetRawQuantity <= 0n ||
    premiumBps <= -10_000 ||
    premiumBps > 2_147_483_647
  )
    throw new Error('invalid quote ceiling');
  const [multiplierWhole, multiplierFraction = ''] = stockMultiplier.split('.');
  const multiplierScale = 10n ** BigInt(multiplierFraction.length);
  const multiplier =
    BigInt(multiplierWhole) * multiplierScale +
    BigInt(multiplierFraction || '0');
  if (multiplier === 0n) throw new Error('invalid quote ceiling');
  let numerator =
    targetRawQuantity *
    multiplier *
    BigInt(referencePrice) *
    BigInt(10_000 + premiumBps) *
    10n ** BigInt(quoteDecimals);
  let denominator = 10n ** BigInt(stockDecimals) * multiplierScale * 10_000n;
  if (referenceExponent >= 0) numerator *= 10n ** BigInt(referenceExponent);
  else denominator *= 10n ** BigInt(-referenceExponent);
  return (numerator + denominator - 1n) / denominator;
}

export function maxAffordableRawQuantity(
  quoteBalance: bigint,
  terms: Omit<Parameters<typeof quoteCapFromReference>[0], 'targetRawQuantity'>,
): bigint {
  if (quoteBalance <= 0n) return 0n;
  let low = 0n;
  let high = 18_446_744_073_709_551_615n;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (
      quoteCapFromReference({ ...terms, targetRawQuantity: middle }) <=
      quoteBalance
    )
      low = middle;
    else high = middle - 1n;
  }
  return low;
}
