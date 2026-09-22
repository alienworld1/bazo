import { getBase58Encoder } from '@solana/codecs-strings';
export * from './recovery';

export const COMMITMENT_SCHEMA_VERSION = 1;
export const DEVNET_NETWORK_ID = 1;
export const STAGE_DOMAIN = 'BAZO_STAGE_V1';
export const TERMINAL_DOMAIN = 'BAZO_STAGE_TERMINAL_V1';

const encoder = new TextEncoder();
const base58Encoder = getBase58Encoder();

export type CanonicalStageV1 = {
  schemaVersion: number;
  network: number;
  plan: string;
  market: string;
  stageIndex: number;
  rawQuantity: bigint;
  minPremiumBps: number;
  allowedSessionMask: number;
  maxReferenceAgeSeconds: number;
  nextCommitment: Uint8Array;
  salt: Uint8Array;
};

export type StageCommitmentInput = Omit<
  CanonicalStageV1,
  'nextCommitment'
>;

export type CommittedStage = CanonicalStageV1 & {
  commitment: Uint8Array;
};

export function encodeCanonicalStage(stage: CanonicalStageV1): Uint8Array {
  assertStage(stage);
  return concatBytes(
    encoder.encode(STAGE_DOMAIN),
    u16(stage.schemaVersion),
    u8(stage.network),
    addressBytes(stage.plan),
    addressBytes(stage.market),
    u16(stage.stageIndex),
    u64(stage.rawQuantity),
    i32(stage.minPremiumBps),
    u8(stage.allowedSessionMask),
    u32(stage.maxReferenceAgeSeconds),
    fixedBytes(stage.nextCommitment, 32, 'next commitment'),
    fixedBytes(stage.salt, 32, 'salt'),
  );
}

export async function hashCanonicalStage(
  stage: CanonicalStageV1,
): Promise<Uint8Array> {
  return sha256(encodeCanonicalStage(stage));
}

export async function terminalCommitment(
  plan: string,
  market: string,
  network = DEVNET_NETWORK_ID,
): Promise<Uint8Array> {
  if (network !== DEVNET_NETWORK_ID) throw new Error('unsupported network');
  return sha256(
    concatBytes(
      encoder.encode(TERMINAL_DOMAIN),
      u8(network),
      addressBytes(plan),
      addressBytes(market),
    ),
  );
}

export async function buildCommitmentChain(
  stages: readonly StageCommitmentInput[],
): Promise<{ headCommitment: Uint8Array; stages: readonly CommittedStage[] }> {
  if (stages.length < 2 || stages.length > 6) {
    throw new Error('a Sell Plan needs between 2 and 6 Stages');
  }
  const first = stages[0];
  if (!first) throw new Error('missing Stage');
  let nextCommitment = await terminalCommitment(
    first.plan,
    first.market,
    first.network,
  );
  const committed: CommittedStage[] = [];

  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const input = stages[index];
    if (!input) throw new Error('missing Stage');
    if (input.stageIndex !== index) throw new Error('Stage indices must be contiguous');
    const stage = { ...input, nextCommitment };
    const commitment = await hashCanonicalStage(stage);
    committed.unshift({ ...stage, commitment });
    nextCommitment = commitment;
  }

  return { headCommitment: nextCommitment, stages: committed };
}

export async function verifyCommitmentChain(
  stages: readonly CommittedStage[],
): Promise<Uint8Array> {
  const result = await buildCommitmentChain(
    stages.map(({ commitment: _commitment, ...stage }) => stage),
  );
  for (const [index, stage] of stages.entries()) {
    const expected = result.stages[index];
    if (!expected || !sameBytes(stage.commitment, expected.commitment)) {
      throw new Error('Stage commitment does not match canonical bytes');
    }
  }
  return result.headCommitment;
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

export function randomPlanNonce(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const nonce = new DataView(bytes.buffer).getBigUint64(0, true);
  if (nonce === 0n) return randomPlanNonce();
  return nonce;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertStage(stage: CanonicalStageV1) {
  if (stage.schemaVersion !== COMMITMENT_SCHEMA_VERSION) {
    throw new Error('unsupported commitment schema');
  }
  if (stage.network !== DEVNET_NETWORK_ID) throw new Error('unsupported network');
  if (!Number.isInteger(stage.stageIndex) || stage.stageIndex < 0 || stage.stageIndex > 65535) {
    throw new Error('invalid Stage index');
  }
  if (stage.rawQuantity <= 0n || stage.rawQuantity > 0xffff_ffff_ffff_ffffn) {
    throw new Error('invalid raw quantity');
  }
  if (!Number.isInteger(stage.minPremiumBps) || stage.minPremiumBps < -2_147_483_648 || stage.minPremiumBps > 2_147_483_647) {
    throw new Error('invalid minimum premium');
  }
  if (!Number.isInteger(stage.allowedSessionMask) || stage.allowedSessionMask < 1 || stage.allowedSessionMask > 15) {
    throw new Error('invalid session mask');
  }
  if (!Number.isInteger(stage.maxReferenceAgeSeconds) || stage.maxReferenceAgeSeconds < 1 || stage.maxReferenceAgeSeconds > 4_294_967_295) {
    throw new Error('invalid reference age');
  }
}

function addressBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(base58Encoder.encode(value));
  return fixedBytes(bytes, 32, 'address');
}

function fixedBytes(value: Uint8Array, length: number, label: string): Uint8Array {
  if (value.length !== length) throw new Error(`invalid ${label} length`);
  return value;
}

function u8(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('invalid u8');
  return Uint8Array.of(value);
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value, true);
  return bytes;
}

function i32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    bytes.set(value, offset);
    offset += value.length;
  }
  return bytes;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const bytes = new Uint8Array(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer));
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}
