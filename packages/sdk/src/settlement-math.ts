const MAX_U64 = (1n << 64n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

export type QuoteChargeInput = {
  rawStock: bigint;
  stockDecimals: number;
  multiplierBits: bigint;
  rawPrice: bigint;
  priceExponent: number;
  premiumBps: number;
  quoteDecimals: number;
};

export function quoteCharge(input: QuoteChargeInput): bigint {
  const {
    rawStock,
    stockDecimals,
    multiplierBits,
    rawPrice,
    priceExponent,
    premiumBps,
    quoteDecimals,
  } = input;
  if (
    rawStock <= 0n ||
    rawStock > MAX_U64 ||
    rawPrice <= 0n ||
    rawPrice > (1n << 63n) - 1n ||
    !Number.isInteger(priceExponent) ||
    priceExponent < -18 ||
    priceExponent > 18 ||
    !Number.isInteger(stockDecimals) ||
    stockDecimals < 0 ||
    stockDecimals > 18 ||
    !Number.isInteger(quoteDecimals) ||
    quoteDecimals < 0 ||
    quoteDecimals > 18 ||
    !Number.isInteger(premiumBps) ||
    premiumBps < -9_999 ||
    premiumBps > 1_000_000
  )
    throw new Error('invalid quote charge input');

  const [multiplierNumerator, multiplierDenominator] =
    multiplierRatio(multiplierBits);
  let numerator = rawStock;
  for (const factor of [
    multiplierNumerator,
    rawPrice,
    BigInt(10_000 + premiumBps),
    10n ** BigInt(quoteDecimals),
  ])
    numerator = checkedMultiply(numerator, factor);
  let denominator = checkedMultiply(
    checkedMultiply(multiplierDenominator, 10n ** BigInt(stockDecimals)),
    10_000n,
  );
  if (priceExponent >= 0)
    numerator = checkedMultiply(numerator, 10n ** BigInt(priceExponent));
  else
    denominator = checkedMultiply(denominator, 10n ** BigInt(-priceExponent));
  const charge = checkedAdd(numerator, denominator - 1n) / denominator;
  if (charge === 0n || charge > MAX_U64)
    throw new Error('quote charge overflow');
  return charge;
}

function multiplierRatio(bits: bigint): [bigint, bigint] {
  if (bits < 0n || bits > MAX_U64) throw new Error('invalid stock multiplier');
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (bits >> 63n !== 0n || exponent === 0 || exponent === 0x7ff)
    throw new Error('invalid stock multiplier');
  const mantissa = (1n << 52n) | fraction;
  const shift = exponent - 1023 - 52;
  if (shift < -64 || shift > 64) throw new Error('invalid stock multiplier');
  const numerator = shift >= 0 ? mantissa << BigInt(shift) : mantissa;
  const denominator = shift >= 0 ? 1n : 1n << BigInt(-shift);
  if (
    numerator > denominator * 1_000_000n ||
    numerator * 1_000_000n < denominator
  )
    throw new Error('invalid stock multiplier');
  return [numerator, denominator];
}

function checkedMultiply(left: bigint, right: bigint): bigint {
  const product = left * right;
  if (product > MAX_U256) throw new Error('quote charge overflow');
  return product;
}

function checkedAdd(left: bigint, right: bigint): bigint {
  const sum = left + right;
  if (sum > MAX_U256) throw new Error('quote charge overflow');
  return sum;
}
