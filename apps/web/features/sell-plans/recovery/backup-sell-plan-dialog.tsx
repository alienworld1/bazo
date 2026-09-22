'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  createBackup,
  serializeBackup,
  type EncryptedPlanPayloadV1,
  type PrivatePlanPackageV1,
} from '@bazo/plan-crypto';
import {
  minimumRecoveryPassphraseLength,
  validateRecoveryPassphrase,
} from './passphrase-validation';

export function BackupSellPlanDialog({
  package: privatePackage,
  payload,
  planKey,
  onClose,
}: {
  package: PrivatePlanPackageV1;
  payload: EncryptedPlanPayloadV1;
  planKey: Uint8Array;
  onClose: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const [creating, setCreating] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLElement>(null);
  const passphraseInput = useRef<HTMLInputElement>(null);
  const validation = validateRecoveryPassphrase(passphrase, confirmation);

  useEffect(() => {
    passphraseInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onClose();
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        ),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [creating, onClose]);

  const create = async () => {
    if (!validation.isValid) {
      setError(
        validation.isLongEnough
          ? 'The passphrases don’t match.'
          : 'Use a longer recovery passphrase.',
      );
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      const backup = await createBackup(payload, planKey, passphrase);
      const blob = new Blob([serializeBackup(backup)], {
        type: 'application/vnd.bazo.private-plan+json',
      });
      const link = document.createElement('a');
      const downloadUrl = URL.createObjectURL(blob);
      link.href = downloadUrl;
      link.download = `${privatePackage.plan.slice(0, 8)}.bazo`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
      setPassphrase('');
      setConfirmation('');
      setComplete(true);
    } catch {
      setError('We couldn’t create this encrypted backup. Try again.');
    } finally {
      setCreating(false);
    }
  };
  const remaining = Math.max(
    0,
    minimumRecoveryPassphraseLength - validation.normalizedLength,
  );

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-canvas/90 p-4"
      role="presentation"
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-[14px] border border-line-default bg-surface-2 p-6 shadow-2xl"
      >
        <h2 id={titleId} className="text-xl font-medium text-text-primary">
          Backup Sell Plan
        </h2>
        {complete ? (
          <div className="mt-4" aria-live="polite">
            <p className="text-sm text-text-primary">
              Encrypted backup downloaded
            </p>
            <p id={descriptionId} className="mt-2 text-sm text-text-secondary">
              Keep the file and recovery passphrase separately. Bazo can’t
              recover the passphrase.
            </p>
            <button
              autoFocus
              type="button"
              onClick={onClose}
              className="mt-6 min-h-11 rounded border border-line-default px-4 text-sm text-text-primary"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p id={descriptionId} className="mt-3 text-sm text-text-secondary">
              Use a recovery passphrase you can keep separately from this file.
              Bazo can’t recover it.
            </p>
            <label
              className="mt-6 block text-sm text-text-secondary"
              htmlFor="backup-passphrase"
            >
              Recovery passphrase
            </label>
            <input
              ref={passphraseInput}
              id="backup-passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onInput={event => {
                setPassphrase(event.currentTarget.value);
                setError(undefined);
              }}
              aria-describedby="backup-passphrase-requirement"
              className="mt-2 min-h-10 w-full rounded border border-line-default bg-surface-1 px-3 text-text-primary"
            />
            <p
              id="backup-passphrase-requirement"
              className="mt-2 text-xs text-text-tertiary"
            >
              {remaining > 0
                ? `${remaining} more ${remaining === 1 ? 'character' : 'characters'} needed (minimum ${minimumRecoveryPassphraseLength}).`
                : `Minimum ${minimumRecoveryPassphraseLength} characters met.`}
            </p>
            <label
              className="mt-4 block text-sm text-text-secondary"
              htmlFor="backup-confirmation"
            >
              Confirm recovery passphrase
            </label>
            <input
              id="backup-confirmation"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onInput={event => {
                setConfirmation(event.currentTarget.value);
                setError(undefined);
              }}
              aria-describedby="backup-confirmation-status"
              className="mt-2 min-h-10 w-full rounded border border-line-default bg-surface-1 px-3 text-text-primary"
            />
            <p
              id="backup-confirmation-status"
              className="mt-2 min-h-4 text-xs text-text-tertiary"
              aria-live="polite"
            >
              {confirmation
                ? validation.confirmationMatches
                  ? 'Passphrases match.'
                  : 'Passphrases don’t match.'
                : 'Enter the same passphrase again.'}
            </p>
            {error ? (
              <p className="mt-3 text-sm text-warning" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void create()}
                disabled={!validation.isValid || creating}
                className="min-h-11 rounded bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled"
              >
                {creating
                  ? 'Creating encrypted backup…'
                  : 'Create encrypted backup'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={creating}
                className="min-h-11 rounded border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
              >
                Close
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
