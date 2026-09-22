'use client';

import type { EncryptedPlanPayloadV1 } from '@bazo/plan-crypto';

const databaseName = 'bazo-private-plans';
const storeName = 'encrypted-payloads';

export async function stageEncryptedPrivatePayload(payload: EncryptedPlanPayloadV1) {
  if (!('indexedDB' in window)) return false;
  try {
    const database = await databaseConnection();
    await new Promise<void>((resolve, reject) => { const transaction = database.transaction(storeName, 'readwrite'); transaction.objectStore(storeName).put(payload, key(payload)); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close(); return true;
  } catch { return false; }
}

export async function readEncryptedPrivatePayload(plan: string, owner: string) {
  if (!('indexedDB' in window)) return undefined;
  try {
    const database = await databaseConnection();
    const value = await new Promise<EncryptedPlanPayloadV1 | undefined>((resolve, reject) => { const request = database.transaction(storeName).objectStore(storeName).get(`${plan}:${owner}`); request.onsuccess = () => resolve(request.result as EncryptedPlanPayloadV1 | undefined); request.onerror = () => reject(request.error); });
    database.close(); return value;
  } catch { return undefined; }
}

function databaseConnection() { return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName, 1); request.onupgradeneeded = () => request.result.createObjectStore(storeName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function key(payload: EncryptedPlanPayloadV1) { return `${payload.plan}:${payload.owner}`; }
