import { describe, expect, it } from 'vitest';
import { aggregateRawAmounts, formatDisplayAmount } from './token-amounts';

describe('token amount utilities', () => {
  it('preserves large raw values when aggregating accounts', () => {
    expect(aggregateRawAmounts(['9007199254740993', '7'])).toBe(
      '9007199254741000',
    );
  });

  it('changes display output when a scaled multiplier changes', () => {
    const rawAmount = '1234500';
    expect(formatDisplayAmount(rawAmount, 4, '1')).toBe('123.45');
    expect(formatDisplayAmount(rawAmount, 4, '2')).toBe('246.9');
  });
});
