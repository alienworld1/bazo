import { describe, expect, it } from 'vitest';
import { getPrivatePlanPreview, rememberPrivatePlan } from './private-plan-memory';

describe('private Sell Plan memory', () => {
  it('returns private Stage previews only to their preparing owner', () => {
    rememberPrivatePlan('plan-address', {
      owner: 'owner-address',
      package: {} as never,
      stages: [{ index: 0, rawQuantity: '1', minPremiumBps: 50, allowedSessions: ['regular'] }],
    });

    expect(getPrivatePlanPreview('plan-address', 'owner-address')).toBeDefined();
    expect(getPrivatePlanPreview('plan-address', 'another-owner')).toBeUndefined();
  });
});
