export function quoteCapFromReference({ targetRawQuantity, stockDecimals, quoteDecimals, referencePrice, referenceExponent, premiumBps }: { targetRawQuantity: bigint; stockDecimals: number; quoteDecimals: number; referencePrice: string; referenceExponent: number; premiumBps: number }): bigint {
  if (!/^\d+$/.test(referencePrice) || targetRawQuantity <= 0n || premiumBps <= -10_000) throw new Error('invalid quote ceiling');
  let numerator = targetRawQuantity * BigInt(referencePrice) * BigInt(10_000 + premiumBps) * (10n ** BigInt(quoteDecimals));
  let denominator = (10n ** BigInt(stockDecimals)) * 10_000n;
  if (referenceExponent >= 0) numerator *= 10n ** BigInt(referenceExponent); else denominator *= 10n ** BigInt(-referenceExponent);
  return (numerator + denominator - 1n) / denominator;
}
