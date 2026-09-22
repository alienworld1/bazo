import { getBase58Encoder } from '@solana/codecs-strings';
import { DEVNET_NETWORK_ID, verifyCommitmentChain, type CommittedStage } from './index';

export const PLAN_CIPHER_SUITE = 'AES-256-GCM/v1';
export const PASSPHRASE_WRAP_METHOD = 'PBKDF2-SHA-256/AES-256-GCM/v1';
export const WALLET_WRAP_METHOD = 'HKDF-SHA-256/AES-256-GCM/v1';
export const BACKUP_FORMAT = 'bazo-private-plan';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base58Encoder = getBase58Encoder();

export type PrivatePlanPackageV1 = {
  packageVersion: 1;
  plan: string;
  market: string;
  owner: string;
  commitmentSchemaVersion: 1;
  stages: readonly CommittedStage[];
  createdAt: number;
};

export type EncryptedPlanPayloadV1 = {
  formatVersion: 1;
  plan: string;
  market: string;
  owner: string;
  network: 1;
  packageVersion: 1;
  commitmentSchemaVersion: 1;
  cipherSuite: typeof PLAN_CIPHER_SUITE;
  payloadNonce: string;
  encryptedPlanPackage: string;
  ciphertextHash: string;
};

export type PassphraseWrappedPlanKeyV1 = {
  wrapVersion: 1;
  method: typeof PASSPHRASE_WRAP_METHOD;
  kdfSalt: string;
  iterations: 600000;
  wrapNonce: string;
  wrappedPlanKey: string;
};

export type WalletWrappedPlanKeyV1 = {
  wrapVersion: 1;
  method: typeof WALLET_WRAP_METHOD;
  messageVersion: 1;
  kdfSalt: string;
  wrapNonce: string;
  wrappedPlanKey: string;
};

export type PrivatePlanBlobRecordV1 = {
  recordVersion: 1;
  plan: string;
  owner: string;
  payload: EncryptedPlanPayloadV1;
  recovery: WalletWrappedPlanKeyV1;
  ciphertextHash: string;
  createdAt: string;
  updatedAt: string;
};

export type BazoBackupV1 = {
  backupFormat: typeof BACKUP_FORMAT;
  formatVersion: 1;
  createdAt: number;
  payload: EncryptedPlanPayloadV1;
  recovery: PassphraseWrappedPlanKeyV1;
  checksum: string;
};

export type VerifiedPlanState = {
  address: string;
  owner: string;
  market: string;
  currentStageIndex: number;
  currentCommitment: string;
  initialRawInventory: string;
};

export function serializePrivatePlanPackage(value: PrivatePlanPackageV1): Uint8Array {
  assertPackage(value);
  return encoder.encode(JSON.stringify({
    ...value,
    stages: value.stages.map(stage => ({
      ...stage,
      rawQuantity: stage.rawQuantity.toString(),
      nextCommitment: encodeBytes(stage.nextCommitment),
      salt: encodeBytes(stage.salt),
      commitment: encodeBytes(stage.commitment),
    })),
  }));
}

export function parsePrivatePlanPackage(bytes: Uint8Array): PrivatePlanPackageV1 {
  const value = parseStrictJson(decoder.decode(bytes), ['packageVersion', 'plan', 'market', 'owner', 'commitmentSchemaVersion', 'stages', 'createdAt']);
  if (value.packageVersion !== 1 || value.commitmentSchemaVersion !== 1 || !Array.isArray(value.stages) || !Number.isInteger(value.createdAt)) throw new Error('invalid private Plan package');
  const stages = value.stages.map((stage, index) => {
    if (!isRecord(stage)) throw new Error('invalid private Plan package');
    assertKeys(stage, ['schemaVersion', 'network', 'plan', 'market', 'stageIndex', 'rawQuantity', 'minPremiumBps', 'allowedSessionMask', 'maxReferenceAgeSeconds', 'nextCommitment', 'salt', 'commitment']);
    return {
      schemaVersion: stage.schemaVersion,
      network: stage.network,
      plan: stage.plan,
      market: stage.market,
      stageIndex: stage.stageIndex,
      rawQuantity: parseInteger(stage.rawQuantity),
      minPremiumBps: stage.minPremiumBps,
      allowedSessionMask: stage.allowedSessionMask,
      maxReferenceAgeSeconds: stage.maxReferenceAgeSeconds,
      nextCommitment: decodeBytes(stage.nextCommitment, 32),
      salt: decodeBytes(stage.salt, 32),
      commitment: decodeBytes(stage.commitment, 32),
    } as CommittedStage;
  });
  const parsed = { packageVersion: 1, plan: stringField(value.plan), market: stringField(value.market), owner: stringField(value.owner), commitmentSchemaVersion: 1, stages, createdAt: value.createdAt } as PrivatePlanPackageV1;
  assertPackage(parsed);
  return parsed;
}

export async function encryptPlanPackage(value: PrivatePlanPackageV1): Promise<{ planKey: Uint8Array; payload: EncryptedPlanPayloadV1 }> {
  const planKey = randomBytes(32);
  return { planKey, payload: await encryptPlanPackageWithKey(value, planKey) };
}

export async function encryptPlanPackageWithKey(value: PrivatePlanPackageV1, planKey: Uint8Array): Promise<EncryptedPlanPayloadV1> {
  assertPackage(value);
  if (planKey.length !== 32) throw new Error('invalid Plan key');
  const payloadNonce = randomBytes(12);
  const base: Omit<EncryptedPlanPayloadV1, 'payloadNonce' | 'encryptedPlanPackage' | 'ciphertextHash'> = { formatVersion: 1, plan: value.plan, market: value.market, owner: value.owner, network: DEVNET_NETWORK_ID, packageVersion: 1, commitmentSchemaVersion: 1, cipherSuite: PLAN_CIPHER_SUITE };
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(payloadNonce), additionalData: buffer(encoder.encode(JSON.stringify(base))), tagLength: 128 }, await crypto.subtle.importKey('raw', buffer(planKey), 'AES-GCM', false, ['encrypt']), buffer(serializePrivatePlanPackage(value))));
  return { ...base, payloadNonce: encodeBytes(payloadNonce), encryptedPlanPackage: encodeBytes(ciphertext), ciphertextHash: encodeBytes(await digest(ciphertext)) };
}

export async function decryptPlanPackage(payload: EncryptedPlanPayloadV1, planKey: Uint8Array): Promise<PrivatePlanPackageV1> {
  assertPayload(payload);
  if (planKey.length !== 32) throw new Error('invalid Plan key');
  const ciphertext = decodeBytes(payload.encryptedPlanPackage, undefined, 256 * 1024);
  if (!equalBytes(await digest(ciphertext), decodeBytes(payload.ciphertextHash, 32))) throw new Error('ciphertext hash mismatch');
  const metadata = { formatVersion: payload.formatVersion, plan: payload.plan, market: payload.market, owner: payload.owner, network: payload.network, packageVersion: payload.packageVersion, commitmentSchemaVersion: payload.commitmentSchemaVersion, cipherSuite: payload.cipherSuite };
  try {
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(decodeBytes(payload.payloadNonce, 12)), additionalData: buffer(encoder.encode(JSON.stringify(metadata))), tagLength: 128 }, await crypto.subtle.importKey('raw', buffer(planKey), 'AES-GCM', false, ['decrypt']), buffer(ciphertext)));
    return parsePrivatePlanPackage(plaintext);
  } catch { throw new Error('private package decryption failed'); }
}

export async function createBackup(payload: EncryptedPlanPayloadV1, planKey: Uint8Array, passphrase: string, createdAt = Math.floor(Date.now() / 1000)): Promise<BazoBackupV1> {
  assertPayload(payload);
  const recovery = await wrapPlanKeyWithPassphrase(planKey, passphrase);
  const checksum = await backupChecksum(payload, recovery, createdAt);
  return { backupFormat: BACKUP_FORMAT, formatVersion: 1, createdAt, payload, recovery, checksum: encodeBytes(checksum) };
}

export function privateRecoveryMessage(owner: string, plan: string): string {
  assertAddress(owner); assertAddress(plan);
  return `Bazo Devnet private Plan recovery\nOwner: ${owner}\nPlan: ${plan}\nFormat: 1\nThis signature authorizes private recovery. It is not a transaction.`;
}

export async function wrapPlanKeyWithWalletSignature(planKey: Uint8Array, signature: Uint8Array, owner: string, plan: string): Promise<WalletWrappedPlanKeyV1> {
  if (planKey.length !== 32 || signature.length !== 64) throw new Error('invalid wallet recovery material');
  const kdfSalt = randomBytes(32); const wrapNonce = randomBytes(12);
  const key = await walletSignatureKey(signature, kdfSalt, owner, plan, ['encrypt']);
  const wrappedPlanKey = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(wrapNonce), tagLength: 128 }, key, buffer(planKey)));
  return { wrapVersion: 1, method: WALLET_WRAP_METHOD, messageVersion: 1, kdfSalt: encodeBytes(kdfSalt), wrapNonce: encodeBytes(wrapNonce), wrappedPlanKey: encodeBytes(wrappedPlanKey) };
}

export async function unwrapPlanKeyWithWalletSignature(value: WalletWrappedPlanKeyV1, signature: Uint8Array, owner: string, plan: string): Promise<Uint8Array> {
  assertWalletRecovery(value);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(decodeBytes(value.wrapNonce, 12)), tagLength: 128 }, await walletSignatureKey(signature, decodeBytes(value.kdfSalt, 32), owner, plan, ['decrypt']), buffer(decodeBytes(value.wrappedPlanKey, 48)))); } catch { throw new Error('wallet recovery key decryption failed'); }
}

export function parsePrivatePlanBlobRecord(source: string): PrivatePlanBlobRecordV1 {
  if (encoder.encode(source).length > 256 * 1024) throw new Error('record too large');
  const value = parseStrictJson(source, ['recordVersion', 'plan', 'owner', 'payload', 'recovery', 'ciphertextHash', 'createdAt', 'updatedAt']);
  if (value.recordVersion !== 1 || !isRecord(value.payload) || !isRecord(value.recovery)) throw new Error('unsupported record');
  const record = { recordVersion: 1, plan: stringField(value.plan), owner: stringField(value.owner), payload: value.payload as EncryptedPlanPayloadV1, recovery: value.recovery as WalletWrappedPlanKeyV1, ciphertextHash: stringField(value.ciphertextHash), createdAt: isoTimestamp(value.createdAt), updatedAt: isoTimestamp(value.updatedAt) } as PrivatePlanBlobRecordV1;
  assertBlobRecord(record); return record;
}

export function serializePrivatePlanBlobRecord(value: PrivatePlanBlobRecordV1): string { assertBlobRecord(value); return JSON.stringify(value); }

export function serializeBackup(value: BazoBackupV1): string { assertBackup(value); return JSON.stringify(value); }
export function parseBackup(source: string): BazoBackupV1 {
  if (encoder.encode(source).length > 256 * 1024) throw new Error('backup too large');
  const value = parseStrictJson(source, ['backupFormat', 'formatVersion', 'createdAt', 'payload', 'recovery', 'checksum']);
  if (value.backupFormat !== BACKUP_FORMAT || value.formatVersion !== 1 || !Number.isInteger(value.createdAt) || !isRecord(value.payload) || !isRecord(value.recovery)) throw new Error('unsupported backup');
  const backup = { backupFormat: BACKUP_FORMAT, formatVersion: 1, createdAt: value.createdAt, payload: value.payload as EncryptedPlanPayloadV1, recovery: value.recovery as PassphraseWrappedPlanKeyV1, checksum: stringField(value.checksum) } as BazoBackupV1;
  assertBackup(backup); return backup;
}

export async function unlockBackup(value: BazoBackupV1, passphrase: string): Promise<{ planKey: Uint8Array; package: PrivatePlanPackageV1 }> {
  assertBackup(value);
  if (!equalBytes(await backupChecksum(value.payload, value.recovery, value.createdAt), decodeBytes(value.checksum, 32))) throw new Error('backup checksum mismatch');
  const planKey = await unwrapPlanKeyWithPassphrase(value.recovery, passphrase);
  return { planKey, package: await decryptPlanPackage(value.payload, planKey) };
}

export async function verifyRestoredPackage(value: PrivatePlanPackageV1, state: VerifiedPlanState): Promise<void> {
  assertPackage(value);
  if (value.plan !== state.address || value.owner !== state.owner || value.market !== state.market || value.stages.length <= state.currentStageIndex) throw new Error('Plan identity mismatch');
  await verifyCommitmentChain(value.stages);
  const current = value.stages[state.currentStageIndex];
  if (!current || toHex(current.commitment) !== state.currentCommitment) throw new Error('current commitment mismatch');
  const total = value.stages.reduce((sum, stage) => sum + stage.rawQuantity, 0n);
  if (total !== BigInt(state.initialRawInventory)) throw new Error('inventory mismatch');
}

export function normalizePassphrase(value: string): string { return value.normalize('NFKC'); }

async function wrapPlanKeyWithPassphrase(planKey: Uint8Array, value: string): Promise<PassphraseWrappedPlanKeyV1> {
  if (planKey.length !== 32 || [...normalizePassphrase(value)].length < 12) throw new Error('invalid recovery passphrase');
  const kdfSalt = randomBytes(32); const wrapNonce = randomBytes(12);
  const key = await passphraseKey(value, kdfSalt, ['encrypt']);
  const wrappedPlanKey = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(wrapNonce), tagLength: 128 }, key, buffer(planKey)));
  return { wrapVersion: 1, method: PASSPHRASE_WRAP_METHOD, kdfSalt: encodeBytes(kdfSalt), iterations: 600000, wrapNonce: encodeBytes(wrapNonce), wrappedPlanKey: encodeBytes(wrappedPlanKey) };
}

async function unwrapPlanKeyWithPassphrase(value: PassphraseWrappedPlanKeyV1, passphrase: string): Promise<Uint8Array> {
  assertRecovery(value);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(decodeBytes(value.wrapNonce, 12)), tagLength: 128 }, await passphraseKey(passphrase, decodeBytes(value.kdfSalt, 32), ['decrypt']), buffer(decodeBytes(value.wrappedPlanKey, 48)))); } catch { throw new Error('backup key decryption failed'); }
}

async function passphraseKey(value: string, salt: Uint8Array, usage: KeyUsage[]) {
  if ([...normalizePassphrase(value)].length < 12) throw new Error('invalid recovery passphrase');
  const material = await crypto.subtle.importKey('raw', buffer(encoder.encode(normalizePassphrase(value))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buffer(salt), iterations: 600000 }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}

async function walletSignatureKey(signature: Uint8Array, salt: Uint8Array, owner: string, plan: string, usage: KeyUsage[]) {
  if (signature.length !== 64) throw new Error('invalid wallet recovery material');
  const material = await crypto.subtle.importKey('raw', buffer(signature), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: buffer(salt), info: buffer(encoder.encode(`BAZO_WALLET_WRAP_V1\n${owner}\n${plan}`)) }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}

async function backupChecksum(payload: EncryptedPlanPayloadV1, recovery: PassphraseWrappedPlanKeyV1, createdAt: number) { return digest(encoder.encode(`BAZO_BACKUP_V1\n${createdAt}\n${JSON.stringify(payload)}\n${JSON.stringify(recovery)}`)); }
function assertBackup(value: BazoBackupV1) { if (value.backupFormat !== BACKUP_FORMAT || value.formatVersion !== 1 || !Number.isInteger(value.createdAt)) throw new Error('unsupported backup'); assertPayload(value.payload); assertRecovery(value.recovery); decodeBytes(value.checksum, 32); }
function assertPayload(value: EncryptedPlanPayloadV1) { if (!isRecord(value) || value.formatVersion !== 1 || value.network !== DEVNET_NETWORK_ID || value.packageVersion !== 1 || value.commitmentSchemaVersion !== 1 || value.cipherSuite !== PLAN_CIPHER_SUITE) throw new Error('unsupported payload'); assertAddress(value.plan); assertAddress(value.market); assertAddress(value.owner); decodeBytes(value.payloadNonce, 12); decodeBytes(value.encryptedPlanPackage, undefined, 256 * 1024); decodeBytes(value.ciphertextHash, 32); }
function assertRecovery(value: PassphraseWrappedPlanKeyV1) { if (!isRecord(value) || value.wrapVersion !== 1 || value.method !== PASSPHRASE_WRAP_METHOD || value.iterations !== 600000) throw new Error('unsupported recovery'); decodeBytes(value.kdfSalt, 32); decodeBytes(value.wrapNonce, 12); decodeBytes(value.wrappedPlanKey, 48); }
function assertWalletRecovery(value: WalletWrappedPlanKeyV1) { if (!isRecord(value) || value.wrapVersion !== 1 || value.method !== WALLET_WRAP_METHOD || value.messageVersion !== 1) throw new Error('unsupported wallet recovery'); decodeBytes(value.kdfSalt, 32); decodeBytes(value.wrapNonce, 12); decodeBytes(value.wrappedPlanKey, 48); }
function assertBlobRecord(value: PrivatePlanBlobRecordV1) { if (value.recordVersion !== 1 || value.plan !== value.payload.plan || value.owner !== value.payload.owner || value.ciphertextHash !== value.payload.ciphertextHash) throw new Error('invalid private record'); assertAddress(value.plan); assertAddress(value.owner); assertPayload(value.payload); assertWalletRecovery(value.recovery); isoTimestamp(value.createdAt); isoTimestamp(value.updatedAt); }
function assertPackage(value: PrivatePlanPackageV1) { if (value.packageVersion !== 1 || value.commitmentSchemaVersion !== 1 || !Number.isInteger(value.createdAt) || value.stages.length < 2 || value.stages.length > 6) throw new Error('invalid private Plan package'); assertAddress(value.plan); assertAddress(value.market); assertAddress(value.owner); }
function assertAddress(value: string) { try { if (new Uint8Array(base58Encoder.encode(value)).length !== 32) throw new Error(); } catch { throw new Error('invalid address'); } }
function parseStrictJson(source: string, keys: readonly string[]) { let value: unknown; try { value = JSON.parse(source); } catch { throw new Error('invalid JSON'); } if (!isRecord(value)) throw new Error('invalid JSON'); assertKeys(value, keys); return value; }
function assertKeys(value: Record<string, unknown>, keys: readonly string[]) { if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error('invalid object shape'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function stringField(value: unknown): string { if (typeof value !== 'string') throw new Error('invalid string'); return value; }
function isoTimestamp(value: unknown): string { const result = stringField(value); if (Number.isNaN(Date.parse(result))) throw new Error('invalid timestamp'); return result; }
function parseInteger(value: unknown): bigint { if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('invalid integer'); return BigInt(value); }
function encodeBytes(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decodeBytes(value: unknown, exactLength?: number, maxLength = exactLength ?? 256 * 1024): Uint8Array { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid bytes'); const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4); let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0)); } catch { throw new Error('invalid bytes'); } if ((exactLength !== undefined && bytes.length !== exactLength) || bytes.length > maxLength) throw new Error('invalid bytes'); return bytes; }
function randomBytes(length: number) { const value = new Uint8Array(length); crypto.getRandomValues(value); return value; }
async function digest(value: Uint8Array) { return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(value))); }
function equalBytes(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((byte, index) => byte === b[index]); }
function buffer(value: Uint8Array): ArrayBuffer { return Uint8Array.from(value).buffer; }
function toHex(value: Uint8Array) { return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join(''); }
