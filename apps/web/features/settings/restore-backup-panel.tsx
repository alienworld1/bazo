'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import {
  parseBackup,
  unlockBackup,
  verifyRestoredPackage,
  type BazoBackupV1,
} from '@bazo/plan-crypto';
import { solanaClient } from '@/components/solana-client';
import { rememberVerifiedPrivatePlan } from '@/features/sell-plans/private-plan-memory';
import { stageEncryptedPrivatePayload } from '@/features/sell-plans/recovery/encrypted-local-plan-store';

type RestoreStatus = 'decrypting' | 'verifying';

export function RestoreBackupPanel() {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [backup, setBackup] = useState<BazoBackupV1>();
  const [fileName, setFileName] = useState<string>();
  const [passphrase, setPassphrase] = useState('');
  const [passphraseOwner, setPassphraseOwner] = useState<string>();
  const [status, setStatus] = useState<RestoreStatus>();
  const [error, setError] = useState<string>();
  const operation = useRef(0);
  const pendingRequest = useRef<AbortController | undefined>(undefined);
  const owner = connected?.account.address;
  const activePassphrase = passphraseOwner === owner ? passphrase : '';

  useEffect(
    () =>
      solanaClient.wallet.subscribe(() => {
        const currentOwner =
          solanaClient.wallet.getState().connected?.account.address;
        if (!passphraseOwner || currentOwner === passphraseOwner) return;
        operation.current += 1;
        pendingRequest.current?.abort();
        setPassphrase('');
        setPassphraseOwner(undefined);
        setStatus(undefined);
      }),
    [passphraseOwner],
  );

  const choose = async (file?: File) => {
    const current = ++operation.current;
    setError(undefined);
    setStatus(undefined);
    setPassphrase('');
    setPassphraseOwner(undefined);
    setBackup(undefined);
    setFileName(undefined);
    if (
      !file ||
      !file.name.toLowerCase().endsWith('.bazo') ||
      file.size === 0 ||
      file.size > 256 * 1024
    ) {
      setError('Choose a valid Bazo backup file.');
      return;
    }
    try {
      const parsed = parseBackup(await file.text());
      if (operation.current !== current) return;
      setBackup(parsed);
      setFileName(file.name);
    } catch (cause) {
      if (operation.current !== current) return;
      setError(importError(cause));
    }
  };

  const restore = async () => {
    if (!backup || !connected || !activePassphrase) return;
    const current = ++operation.current;
    const controller = new AbortController();
    pendingRequest.current = controller;
    setError(undefined);
    setStatus('decrypting');
    try {
      if (backup.payload.owner !== connected.account.address) {
        throw new Error('owner_mismatch');
      }
      const { package: privatePackage, planKey } = await unlockBackup(
        backup,
        activePassphrase,
      );
      if (operation.current !== current) return;
      setStatus('verifying');
      const response = await fetch(`/api/sell-plans/${privatePackage.plan}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('chain_unavailable');
      await verifyRestoredPackage(privatePackage, await response.json());
      if (
        operation.current !== current ||
        solanaClient.wallet.getState().connected?.account.address !==
          privatePackage.owner
      )
        return;
      await stageEncryptedPrivatePayload(backup.payload);
      rememberVerifiedPrivatePlan(privatePackage, backup.payload, planKey);
      setPassphrase('');
      setPassphraseOwner(undefined);
      setBackup(undefined);
      setFileName(undefined);
      setStatus(undefined);
      pendingRequest.current = undefined;
      router.push(`/sell-plans/${privatePackage.plan}?recovery=restored`);
    } catch (cause) {
      if (operation.current !== current) return;
      setPassphrase('');
      setPassphraseOwner(undefined);
      setStatus(undefined);
      pendingRequest.current = undefined;
      setError(restoreError(cause));
    }
  };

  const chooseAnother = () => {
    operation.current += 1;
    pendingRequest.current?.abort();
    pendingRequest.current = undefined;
    setBackup(undefined);
    setFileName(undefined);
    setPassphrase('');
    setPassphraseOwner(undefined);
    setStatus(undefined);
    setError(undefined);
  };

  return (
    <section className="mx-auto max-w-xl border-y border-line-default py-8">
      <p className="font-mono text-xs text-text-tertiary">SECURITY</p>
      <h1 className="mt-3 text-3xl font-medium text-text-primary">
        Restore backup
      </h1>
      <p className="mt-3 text-text-secondary">
        Restore the private details for a Sell Plan from an encrypted Bazo
        backup.
      </p>
      <label
        className="mt-8 block text-sm text-text-secondary"
        htmlFor="backup-file"
      >
        Encrypted backup file
      </label>
      <input
        id="backup-file"
        type="file"
        accept=".bazo,application/vnd.bazo.private-plan+json"
        onChange={event => void choose(event.target.files?.[0])}
        className="mt-2 block min-h-11 w-full text-sm text-text-secondary"
      />
      {backup ? (
        <>
          <p className="mt-3 font-mono text-xs text-text-tertiary">
            {fileName} · Plan {shortAddress(backup.payload.plan)}
          </p>
          <label
            className="mt-6 block text-sm text-text-secondary"
            htmlFor="restore-passphrase"
          >
            Recovery passphrase
          </label>
          <input
            id="restore-passphrase"
            type="password"
            autoComplete="current-password"
            value={activePassphrase}
            onInput={event => {
              setPassphrase(event.currentTarget.value);
              setPassphraseOwner(owner);
              setError(undefined);
            }}
            className="mt-2 min-h-10 w-full rounded border border-line-default bg-surface-1 px-3 text-text-primary"
          />
          <p className="mt-2 text-sm text-text-secondary">
            {!connected
              ? 'Connect the wallet that owns this Sell Plan to restore private details.'
              : connected.account.address !== backup.payload.owner
                ? 'Reconnect the wallet that owns this Sell Plan.'
                : 'The backup will be decrypted here, then checked against the current onchain Plan.'}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={
                !connected ||
                connected.account.address !== backup.payload.owner ||
                !activePassphrase ||
                Boolean(status)
              }
              onClick={() => void restore()}
              className="min-h-11 rounded bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled"
            >
              Restore and verify
            </button>
            <button
              type="button"
              disabled={Boolean(status)}
              onClick={chooseAnother}
              className="min-h-11 text-sm text-text-primary underline disabled:text-text-disabled"
            >
              Choose another file
            </button>
          </div>
        </>
      ) : null}
      {status ? (
        <p className="mt-5 text-sm text-text-secondary" aria-live="polite">
          {status === 'decrypting'
            ? 'Decrypting on this device…'
            : 'Verifying with Solana…'}
        </p>
      ) : null}
      {error ? (
        <p className="mt-5 text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      <section className="mt-10 border-t border-line-default pt-5">
        <h2 className="text-lg font-medium text-text-primary">
          Private Plan details unavailable
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Bazo can’t continue this sealed path without its private Plan details.
          Your funds remain controlled by the onchain Plan. Restore a backup or
          cancel the remaining Plan when it becomes available.
        </p>
      </section>
      <Link
        href="/portfolio"
        className="mt-8 inline-flex min-h-11 items-center text-sm text-text-primary underline"
      >
        Back to portfolio
      </Link>
    </section>
  );
}

function importError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '';
  if (message.includes('unsupported'))
    return 'This backup version isn’t supported by this version of Bazo.';
  return 'Choose a valid Bazo backup file.';
}

function restoreError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'owner_mismatch' || message.includes('identity'))
    return 'Reconnect the wallet that owns this Sell Plan.';
  if (message.includes('backup checksum'))
    return 'This backup appears incomplete or changed.';
  if (message.includes('decryption'))
    return 'That passphrase couldn’t unlock this backup.';
  if (message.includes('commitment') || message.includes('inventory'))
    return 'These private details don’t match the current onchain Plan. Nothing was restored.';
  return 'We couldn’t verify this backup with Solana. Nothing was restored.';
}

function shortAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
