import { describe, expect, it } from 'vitest';
import {
  aggregateRawAmounts,
  formatDisplayAmount,
  parseDisplayAmountToRaw,
} from './token-amounts';

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

  it('derives a non-exceeding raw amount from a display entry', () => {
    expect(parseDisplayAmountToRaw('246.9', 4, '2')).toBe('1234500');
    expect(parseDisplayAmountToRaw('1.00009', 4, '1')).toBe('10000');
  });
});
