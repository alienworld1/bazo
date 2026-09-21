export type StageAllocation = {
  allocationBps: number;
  rawQuantity: bigint;
};

const ALLOCATION_DENOMINATOR = 10_000n;

export function allocateStageInventory(
  committedRawAmount: bigint,
  allocationBps: readonly number[],
): StageAllocation[] {
  if (committedRawAmount <= 0n) throw new Error('committed amount must be positive');
  if (allocationBps.length < 2 || allocationBps.length > 6) {
    throw new Error('use between 2 and 6 Stages');
  }
  if (allocationBps.some(value => !Number.isInteger(value) || value < 1)) {
    throw new Error('each Stage needs a positive allocation');
  }
  if (allocationBps.reduce((total, value) => total + value, 0) !== 10_000) {
    throw new Error('Stage allocations must add up to 100.00%');
  }

  const allocations = allocationBps.map((basisPoints, index) => {
    const numerator = committedRawAmount * BigInt(basisPoints);
    return {
      basisPoints,
      index,
      rawQuantity: numerator / ALLOCATION_DENOMINATOR,
      remainder: numerator % ALLOCATION_DENOMINATOR,
    };
  });
  let remaining = committedRawAmount - allocations.reduce(
    (total, allocation) => total + allocation.rawQuantity,
    0n,
  );
  const ranked = [...allocations].sort(
    (left, right) =>
      right.remainder === left.remainder
        ? left.index - right.index
        : right.remainder > left.remainder
          ? 1
          : -1,
  );
  for (const allocation of ranked) {
    if (remaining === 0n) break;
    allocation.rawQuantity += 1n;
    remaining -= 1n;
  }

  return allocations.map(({ basisPoints, rawQuantity }) => ({
    allocationBps: basisPoints,
    rawQuantity,
  }));
}
