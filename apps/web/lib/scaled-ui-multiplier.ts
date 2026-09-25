type ScaledUiAmountConfig = {
  multiplier: number;
  newMultiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
};

export function currentScaledUiMultiplier(
  config: ScaledUiAmountConfig,
  chainNow: bigint,
): string {
  const current =
    chainNow >= config.newMultiplierEffectiveTimestamp
      ? config.newMultiplier
      : config.multiplier;
  const multiplier = String(current);
  if (!/^\d+(?:\.\d+)?$/.test(multiplier) || current <= 0)
    throw new Error('unsupported_stock_multiplier');
  return multiplier;
}
