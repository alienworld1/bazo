import { normalizePassphrase } from '@bazo/plan-crypto';

export const minimumRecoveryPassphraseLength = 12;

export type PassphraseValidation = {
  confirmationMatches: boolean;
  isLongEnough: boolean;
  isValid: boolean;
  normalizedLength: number;
};

export function validateRecoveryPassphrase(
  passphrase: string,
  confirmation: string,
): PassphraseValidation {
  const normalizedPassphrase = normalizePassphrase(passphrase);
  const normalizedConfirmation = normalizePassphrase(confirmation);
  const normalizedLength = [...normalizedPassphrase].length;
  const isLongEnough = normalizedLength >= minimumRecoveryPassphraseLength;
  const confirmationMatches = normalizedPassphrase === normalizedConfirmation;

  return {
    confirmationMatches,
    isLongEnough,
    isValid: isLongEnough && confirmationMatches,
    normalizedLength,
  };
}
