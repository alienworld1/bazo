'use client';

import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  decryptPlanPackage,
  parsePrivatePlanBlobRecord,
  privateRecoveryMessage,
  unwrapPlanKeyWithWalletSignature,
  verifyRestoredPackage,
  type PrivatePlanBlobRecordV1,
} from '@bazo/plan-crypto';
import { solanaClient } from '@/components/solana-client';
import {
  getPrivatePlanPackage,
  getPrivatePlanRecoveryMaterial,
  getPrivatePlanRevision,
  rememberVerifiedPrivatePlan,
  subscribeToPrivatePlans,
} from '../private-plan-memory';
import {
  readEncryptedPrivateRecord,
  saveEncryptedPrivateRecord,
} from './encrypted-local-plan-store';
import {
  createWalletWrappedRecord,
  downloadPrivateRecord,
  uploadPrivateRecord,
} from './private-storage-client';
import { supportsAutomaticPrivateRecovery } from './wallet-recovery-compatibility';

type RecoveryStatus =
  | 'checking'
  | 'decrypting'
  | 'idle'
  | 'restored'
  | 'saved'
  | 'saving'
  | 'verifying'
  | 'waiting';

const encoder = new TextEncoder();

export function usePlanRecovery(plan: string, owner: string) {
  const connected = useConnectedWallet(solanaClient);
  useSyncExternalStore(
    subscribeToPrivatePlans,
    getPrivatePlanRevision,
    getPrivatePlanRevision,
  );
  const [status, setStatus] = useState<RecoveryStatus>('idle');
  const [error, setError] = useState<string>();
  const saveController = useRef<AbortController | undefined>(undefined);
  const isOwner = connected?.account.address === owner;
  const privatePackage = isOwner
    ? getPrivatePlanPackage(plan, owner)
    : undefined;
  const recoveryMaterial = isOwner
    ? getPrivatePlanRecoveryMaterial(plan, owner)
    : undefined;
  const compatible = connected
    ? supportsAutomaticPrivateRecovery(connected.wallet)
    : false;

  const restoreRecord = useCallback(
    async (record: PrivatePlanBlobRecordV1, signal: AbortSignal) => {
      setStatus('waiting');
      const signature = await solanaClient.wallet.signMessage(
        encoder.encode(privateRecoveryMessage(owner, plan)),
        { abortSignal: signal },
      );
      signal.throwIfAborted();
      setStatus('decrypting');
      const planKey = await unwrapPlanKeyWithWalletSignature(
        record.recovery,
        new Uint8Array(signature),
        owner,
        plan,
      );
      const privatePackage = await decryptPlanPackage(record.payload, planKey);
      signal.throwIfAborted();
      setStatus('verifying');
      const response = await fetch(`/api/sell-plans/${plan}`, {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error('chain_unavailable');
      await verifyRestoredPackage(privatePackage, await response.json());
      signal.throwIfAborted();
      if (solanaClient.wallet.getState().connected?.account.address !== owner) {
        throw new Error('wallet_changed');
      }
      rememberVerifiedPrivatePlan(privatePackage, record.payload, planKey);
      await saveEncryptedPrivateRecord(record);
      setStatus('restored');
    },
    [owner, plan],
  );

  const recover = useCallback(
    async (signal: AbortSignal) => {
      setError(undefined);
      setStatus('checking');
      try {
        let record = await readEncryptedPrivateRecord(plan, owner);
        signal.throwIfAborted();
        if (!record) {
          setStatus('waiting');
          record = await downloadPrivateRecord(plan, owner, signal);
        }
        if (!record) {
          setStatus('idle');
          return;
        }
        await restoreRecord(
          parsePrivatePlanBlobRecord(JSON.stringify(record)),
          signal,
        );
      } catch (cause) {
        if (signal.aborted) return;
        setStatus('idle');
        setError(recoveryError(cause));
      }
    },
    [owner, plan, restoreRecord],
  );

  useEffect(() => {
    if (!isOwner || !compatible || privatePackage) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void recover(controller.signal);
    });
    return () => controller.abort();
  }, [compatible, isOwner, privatePackage, recover]);

  useEffect(
    () => () => saveController.current?.abort(),
    [connected?.account.address],
  );

  useEffect(
    () =>
      solanaClient.wallet.subscribe(() => {
        if (solanaClient.wallet.getState().connected?.account.address === owner)
          return;
        saveController.current?.abort();
        setStatus('idle');
        setError(undefined);
      }),
    [owner],
  );

  const save = async () => {
    if (!recoveryMaterial || !compatible) return;
    const controller = new AbortController();
    saveController.current = controller;
    setError(undefined);
    setStatus('waiting');
    try {
      const record = await createWalletWrappedRecord(
        recoveryMaterial.payload,
        recoveryMaterial.planKey,
        controller.signal,
      );
      await saveEncryptedPrivateRecord(record);
      setStatus('saving');
      await uploadPrivateRecord(record, controller.signal);
      setStatus('saved');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus('idle');
      setError(recoveryError(cause));
    } finally {
      if (saveController.current === controller)
        saveController.current = undefined;
    }
  };

  const busy = [
    'checking',
    'decrypting',
    'saving',
    'verifying',
    'waiting',
  ].includes(status);
  const hasMaterial = Boolean(privatePackage && recoveryMaterial);

  return {
    busy,
    canSave: compatible && hasMaterial,
    error,
    hasMaterial,
    isOwner,
    privatePackage,
    recoveryMaterial,
    save,
    status,
    statusCopy: recoveryStatus(status, compatible, hasMaterial),
  };
}

function recoveryStatus(
  status: RecoveryStatus,
  compatible: boolean,
  hasMaterial: boolean,
) {
  if (status === 'checking')
    return [
      'Checking for a private copy…',
      'Your public Plan remains available while recovery is checked.',
    ] as const;
  if (status === 'waiting')
    return [
      'Waiting for wallet approval…',
      'This signature authorizes private recovery. It doesn’t submit a transaction or move assets.',
    ] as const;
  if (status === 'decrypting')
    return [
      'Decrypting on this device…',
      'Private details stay in this browser.',
    ] as const;
  if (status === 'verifying')
    return [
      'Verifying with Solana…',
      'Private details appear only after they match the current onchain Plan.',
    ] as const;
  if (status === 'saving')
    return [
      'Saving private copy',
      'Your Stage details were encrypted on this device before they were saved.',
    ] as const;
  if (status === 'saved')
    return [
      'Private copy saved',
      'Your Stage details were encrypted on this device before they were saved.',
    ] as const;
  if (status === 'restored')
    return [
      'Backup restored',
      'Private Plan details restored and verified.',
    ] as const;
  if (!compatible)
    return [
      'Recovery not set up',
      'Automatic private recovery isn’t available with this wallet. Download an encrypted backup to protect this Plan.',
    ] as const;
  if (!hasMaterial)
    return [
      'Restore required',
      'Restore an encrypted backup to continue this sealed path.',
    ] as const;
  return [
    'Backup ready',
    'Download an encrypted backup or save a private copy for recovery after refresh.',
  ] as const;
}

function recoveryError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'storage_conflict')
    return 'A newer private copy is already saved. Reload it before trying again.';
  if (message === 'wallet_changed')
    return 'Reconnect the wallet that owns this Sell Plan.';
  if (message.includes('wallet recovery key decryption'))
    return 'This private copy couldn’t be verified. Restore a known-good backup.';
  if (
    message.includes('commitment') ||
    message.includes('inventory') ||
    message.includes('identity')
  )
    return 'This private copy couldn’t be verified. Restore a known-good backup.';
  if (message.includes('reject') || message.includes('cancel'))
    return 'Authorization canceled. Your Plan and saved backup weren’t changed.';
  return 'Your Plan is safe onchain, but its private copy is temporarily unavailable.';
}
