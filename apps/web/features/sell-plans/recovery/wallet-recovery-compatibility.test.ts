import { describe, expect, it } from 'vitest';
import { supportsAutomaticPrivateRecovery } from './wallet-recovery-compatibility';

describe('wallet recovery compatibility', () => {
  it('fails closed for unknown names, versions, and missing message signing', () => {
    expect(
      supportsAutomaticPrivateRecovery({
        name: 'Unknown',
        version: '1.0.0',
        features: ['solana:signMessage'],
      }),
    ).toBe(false);
    expect(
      supportsAutomaticPrivateRecovery({
        name: 'Phantom',
        version: '2.0.0',
        features: ['solana:signMessage'],
      }),
    ).toBe(false);
    expect(
      supportsAutomaticPrivateRecovery({
        name: 'Phantom',
        version: '1.0.0',
        features: [],
      }),
    ).toBe(false);
  });

  it('allows the release-tested wallet identity and message feature', () => {
    expect(
      supportsAutomaticPrivateRecovery({
        name: 'Phantom',
        version: '1.0.0',
        features: ['solana:signMessage'],
      }),
    ).toBe(true);
  });
});
