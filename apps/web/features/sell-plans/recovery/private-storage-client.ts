'use client';

import {
  privateRecoveryMessage,
  serializePrivatePlanBlobRecord,
  wrapPlanKeyWithWalletSignature,
  type EncryptedPlanPayloadV1,
  type PrivatePlanBlobRecordV1,
} from '@bazo/plan-crypto';
import { solanaClient } from '@/components/solana-client';

const encoder = new TextEncoder();

export async function createWalletWrappedRecord(
  payload: EncryptedPlanPayloadV1,
  planKey: Uint8Array,
  signal?: AbortSignal,
): Promise<PrivatePlanBlobRecordV1> {
  assertCurrentOwner(payload.owner);
  const signature = await solanaClient.wallet.signMessage(
    encoder.encode(privateRecoveryMessage(payload.owner, payload.plan)),
    { abortSignal: signal },
  );
  signal?.throwIfAborted();
  assertCurrentOwner(payload.owner);
  const recovery = await wrapPlanKeyWithWalletSignature(
    planKey,
    new Uint8Array(signature),
    payload.owner,
    payload.plan,
  );
  const timestamp = new Date().toISOString();
  return {
    recordVersion: 1,
    plan: payload.plan,
    owner: payload.owner,
    payload,
    recovery,
    ciphertextHash: payload.ciphertextHash,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function authenticatePrivateStorage(
  owner: string,
  signal?: AbortSignal,
) {
  assertCurrentOwner(owner);
  const challengeResponse = await fetch('/api/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, purpose: 'private-plan-storage' }),
    cache: 'no-store',
    signal,
  });
  if (!challengeResponse.ok) throw new Error('storage_unavailable');
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
  };
  const signature = await solanaClient.wallet.signMessage(
    encoder.encode(challenge.message),
    { abortSignal: signal },
  );
  signal?.throwIfAborted();
  assertCurrentOwner(owner);
  const verifyResponse = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      owner,
      signature: encodeBase64Url(new Uint8Array(signature)),
    }),
    cache: 'no-store',
    signal,
  });
  if (!verifyResponse.ok) throw new Error('authorization_failed');
}

export async function uploadPrivateRecord(
  record: PrivatePlanBlobRecordV1,
  signal?: AbortSignal,
) {
  await authenticatePrivateStorage(record.owner, signal);
  const response = await fetch(`/api/sell-plans/${record.plan}/private`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: serializePrivatePlanBlobRecord(record),
    cache: 'no-store',
    signal,
  });
  if (response.status === 409) throw new Error('storage_conflict');
  if (!response.ok) throw new Error('storage_unavailable');
  return response.json() as Promise<{
    ciphertextHash: string;
    plan: string;
    updatedAt: string;
  }>;
}

export async function downloadPrivateRecord(
  plan: string,
  owner: string,
  signal?: AbortSignal,
) {
  await authenticatePrivateStorage(owner, signal);
  const response = await fetch(`/api/sell-plans/${plan}/private`, {
    cache: 'no-store',
    signal,
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('storage_unavailable');
  return response.json() as Promise<PrivatePlanBlobRecordV1>;
}

function assertCurrentOwner(owner: string) {
  if (solanaClient.wallet.getState().connected?.account.address !== owner) {
    throw new Error('wallet_changed');
  }
}

function encodeBase64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
