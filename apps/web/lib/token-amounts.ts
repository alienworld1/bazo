export function aggregateRawAmounts(amounts: readonly string[]): string {
  return amounts
    .reduce((total, amount) => {
      if (!/^\d+$/.test(amount)) throw new Error('invalid raw amount');
      return total + BigInt(amount);
    }, BigInt(0))
    .toString();
}

export function formatDisplayAmount(
  rawAmount: string,
  decimals: number,
  multiplier = '1',
): string {
  if (
    !/^\d+$/.test(rawAmount) ||
    !/^\d+(\.\d+)?$/.test(multiplier) ||
    decimals < 0
  ) {
    throw new Error('invalid display conversion input');
  }
  const scale = BigInt(10) ** BigInt(decimals);
  const [wholeMultiplier, fractionMultiplier = ''] = multiplier.split('.');
  const multiplierScale = BigInt(10) ** BigInt(fractionMultiplier.length);
  const displayScaled =
    BigInt(rawAmount) *
    (BigInt(wholeMultiplier) * multiplierScale +
      BigInt(fractionMultiplier || '0'));
  const denominator = scale * multiplierScale;
  const whole = displayScaled / denominator;
  const fraction = (displayScaled % denominator)
    .toString()
    .padStart(decimals + fractionMultiplier.length, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
