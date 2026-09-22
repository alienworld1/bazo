'use client';

import {
  parsePrivatePlanBlobRecord,
  serializePrivatePlanBlobRecord,
  type EncryptedPlanPayloadV1,
  type PrivatePlanBlobRecordV1,
} from '@bazo/plan-crypto';

const databaseName = 'bazo-private-plans';
const payloadStoreName = 'encrypted-payloads';
const recordStoreName = 'wallet-wrapped-records';

export async function stageEncryptedPrivatePayload(
  payload: EncryptedPlanPayloadV1,
) {
  if (!('indexedDB' in window)) return false;
  try {
    const database = await databaseConnection();
    await put(database, payloadStoreName, key(payload), payload);
    database.close();
    return true;
  } catch {
    return false;
  }
}

export async function readEncryptedPrivatePayload(plan: string, owner: string) {
  if (!('indexedDB' in window)) return undefined;
  try {
    const database = await databaseConnection();
    const value = await get<EncryptedPlanPayloadV1>(
      database,
      payloadStoreName,
      `${plan}:${owner}`,
    );
    database.close();
    return value;
  } catch {
    return undefined;
  }
}

export async function saveEncryptedPrivateRecord(
  record: PrivatePlanBlobRecordV1,
) {
  if (!('indexedDB' in window)) return false;
  try {
    const database = await databaseConnection();
    await put(
      database,
      recordStoreName,
      `${record.plan}:${record.owner}`,
      serializePrivatePlanBlobRecord(record),
    );
    database.close();
    return true;
  } catch {
    return false;
  }
}

export async function readEncryptedPrivateRecord(plan: string, owner: string) {
  if (!('indexedDB' in window)) return undefined;
  try {
    const database = await databaseConnection();
    const source = await get<string>(
      database,
      recordStoreName,
      `${plan}:${owner}`,
    );
    database.close();
    return source ? parsePrivatePlanBlobRecord(source) : undefined;
  } catch {
    return undefined;
  }
}

function databaseConnection() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(payloadStoreName)) {
        request.result.createObjectStore(payloadStoreName);
      }
      if (!request.result.objectStoreNames.contains(recordStoreName)) {
        request.result.createObjectStore(recordStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(
  database: IDBDatabase,
  store: string,
  recordKey: string,
  value: unknown,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value, recordKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function get<T>(database: IDBDatabase, store: string, recordKey: string) {
  return new Promise<T | undefined>((resolve, reject) => {
    const request = database
      .transaction(store)
      .objectStore(store)
      .get(recordKey);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function key(payload: EncryptedPlanPayloadV1) {
  return `${payload.plan}:${payload.owner}`;
}
