import { describe, expect, it } from 'vitest';
import { allocateStageInventory } from './stage-allocation';

describe('Stage allocation', () => {
  it('conserves every raw unit with stable remainder ties', () => {
    expect(allocateStageInventory(7n, [2_500, 2_500, 2_500, 2_500])).toEqual([
      { allocationBps: 2_500, rawQuantity: 2n },
      { allocationBps: 2_500, rawQuantity: 2n },
      { allocationBps: 2_500, rawQuantity: 2n },
      { allocationBps: 2_500, rawQuantity: 1n },
    ]);
  });

  it('rejects allocations that are not an exact whole', () => {
    expect(() => allocateStageInventory(10n, [5_000, 4_999])).toThrow(
      'Stage allocations must add up to 100.00%',
    );
  });
});
