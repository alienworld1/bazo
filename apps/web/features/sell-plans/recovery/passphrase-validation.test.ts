import { describe, expect, it } from 'vitest';
import {
  minimumRecoveryPassphraseLength,
  validateRecoveryPassphrase,
} from './passphrase-validation';

describe('recovery passphrase validation', () => {
  it('requires twelve Unicode code points and matching normalized values', () => {
    expect(validateRecoveryPassphrase('short', 'short').isValid).toBe(false);
    expect(
      validateRecoveryPassphrase(
        'a'.repeat(minimumRecoveryPassphraseLength),
        'a'.repeat(minimumRecoveryPassphraseLength),
      ).isValid,
    ).toBe(true);
  });

  it('compares the same normalization used by key derivation', () => {
    const composed = `secure-${'e\u0301'.repeat(5)}`;
    const precomposed = `secure-${'é'.repeat(5)}`;
    expect(validateRecoveryPassphrase(composed, precomposed).isValid).toBe(
      true,
    );
  });
});
