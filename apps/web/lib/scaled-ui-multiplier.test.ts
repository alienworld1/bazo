import { describe, expect, it } from 'vitest';
import { currentScaledUiMultiplier } from './scaled-ui-multiplier';
import { formatDisplayAmount } from './token-amounts';

describe('Scaled UI Amount multiplier', () => {
  const config = {
    multiplier: 1,
    newMultiplier: 2,
    newMultiplierEffectiveTimestamp: 100n,
  };

  it('keeps the old display before the chain effective time', () => {
    expect(currentScaledUiMultiplier(config, 99n)).toBe('1');
  });

  it('uses the new display at and after the chain effective time', () => {
    expect(currentScaledUiMultiplier(config, 100n)).toBe('2');
    expect(currentScaledUiMultiplier(config, 101n)).toBe('2');
  });

  it('changes displayed shares without changing raw custody', () => {
    const rawAmount = '10000000';
    expect(
      formatDisplayAmount(rawAmount, 6, currentScaledUiMultiplier(config, 99n)),
    ).toBe('10');
    expect(
      formatDisplayAmount(rawAmount, 6, currentScaledUiMultiplier(config, 100n)),
    ).toBe('20');
    expect(rawAmount).toBe('10000000');
  });

  it('rejects a multiplier that cannot be displayed safely', () => {
    expect(() =>
      currentScaledUiMultiplier({ ...config, newMultiplier: 0 }, 100n),
    ).toThrow('unsupported_stock_multiplier');
  });
});
