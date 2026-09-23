import { address, isAddress } from '@solana/kit';
import type { CanonicalStageV1 } from '@bazo/plan-crypto';
import type { BuyRequestOpeningV1 } from './index';

export function parseBuyOpening(value: unknown): BuyRequestOpeningV1 {
  const data = record(value, [
    'schemaVersion',
    'network',
    'request',
    'buyer',
    'recipient',
    'market',
    'targetRawQuantity',
    'maxPremiumBps',
    'maxQuoteAmount',
    'expiresAt',
    'allowPartialFills',
    'requestNonce',
    'salt',
  ]);
  if (
    data.schemaVersion !== 1 ||
    data.network !== 1 ||
    typeof data.allowPartialFills !== 'boolean'
  )
    throw new Error('invalid opening');
  const opening: BuyRequestOpeningV1 = {
    schemaVersion: 1,
    network: 1,
    request: publicKey(data.request),
    buyer: publicKey(data.buyer),
    recipient: publicKey(data.recipient),
    market: publicKey(data.market),
    targetRawQuantity: unsigned(data.targetRawQuantity),
    maxPremiumBps: integer(data.maxPremiumBps),
    maxQuoteAmount: unsigned(data.maxQuoteAmount),
    expiresAt: unsigned(data.expiresAt),
    allowPartialFills: data.allowPartialFills,
    requestNonce: unsigned(data.requestNonce),
    salt: bytes(data.salt),
  };
  if (opening.targetRawQuantity === 0n || opening.maxQuoteAmount === 0n)
    throw new Error('invalid opening');
  return opening;
}

export function parseStageOpening(value: unknown): CanonicalStageV1 {
  const data = record(value, [
    'schemaVersion',
    'network',
    'plan',
    'market',
    'stageIndex',
    'rawQuantity',
    'minPremiumBps',
    'allowedSessionMask',
    'maxReferenceAgeSeconds',
    'nextCommitment',
    'salt',
  ]);
  if (data.schemaVersion !== 1 || data.network !== 1)
    throw new Error('invalid opening');
  const opening: CanonicalStageV1 = {
    schemaVersion: 1,
    network: 1,
    plan: publicKey(data.plan),
    market: publicKey(data.market),
    stageIndex: integer(data.stageIndex),
    rawQuantity: unsigned(data.rawQuantity),
    minPremiumBps: integer(data.minPremiumBps),
    allowedSessionMask: integer(data.allowedSessionMask),
    maxReferenceAgeSeconds: integer(data.maxReferenceAgeSeconds),
    nextCommitment: bytes(data.nextCommitment),
    salt: bytes(data.salt),
  };
  if (opening.rawQuantity === 0n) throw new Error('invalid opening');
  return opening;
}

export function serializeOpening(
  opening: BuyRequestOpeningV1 | CanonicalStageV1,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(opening).map(([key, value]) => [
      key,
      typeof value === 'bigint'
        ? value.toString()
        : value instanceof Uint8Array
          ? hex(value)
          : value,
    ]),
  );
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid opening');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== keys.length ||
    Object.keys(data).some(key => !keys.includes(key))
  )
    throw new Error('invalid opening');
  return data;
}
function publicKey(value: unknown) {
  if (typeof value !== 'string' || !isAddress(value))
    throw new Error('invalid opening');
  return address(value);
}
function unsigned(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value))
    throw new Error('invalid opening');
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throw new Error('invalid opening');
  return result;
}
function integer(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('invalid opening');
  return value;
}
function bytes(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('invalid opening');
  return Uint8Array.from(value.match(/../g)!, part =>
    Number.parseInt(part, 16),
  );
}
function hex(value: Uint8Array) {
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}
