import {
  AccountRole,
  address,
  createSolanaRpc,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  isAddress,
  parseBase64RpcAccount,
  type Address,
  type Instruction,
} from '@solana/kit';

export const BATCH_VERSION = 1;
export const MIN_BATCH_WINDOW_SECONDS = 30n;
export const MAX_BATCH_WINDOW_SECONDS = 60n;
export const MAX_BATCH_REQUESTS = 4;
export const BATCH_ACCOUNT_DATA_LENGTH = 233;
const discriminator = Uint8Array.of(156, 194, 70, 44, 22, 88, 137, 44);
const policyDiscriminator = Uint8Array.of(223, 18, 232, 210, 103, 170, 67, 65);
const text = new TextEncoder();
const encodeAddress = getAddressEncoder();
const decodeAddress = getBase58Decoder();

export type PublicBatch = {
  address: string;
  market: string;
  windowStart: string;
  windowEnd: string;
  windowSeconds: string;
  lockSeconds: string;
  createdSlot: string;
  lockSlot: string | null;
  lockDeadline: string;
  status: 'open' | 'locked' | 'expired' | 'settled';
  requests: string[];
};

export type PublicBatchPolicy = {
  address: string;
  market: string;
  windowSeconds: string;
  lockSeconds: string;
};

export function batchWindowStart(
  chainTime: bigint,
  windowSeconds: bigint,
): bigint {
  if (
    windowSeconds < MIN_BATCH_WINDOW_SECONDS ||
    windowSeconds > MAX_BATCH_WINDOW_SECONDS
  )
    throw new Error('invalid Batch window');
  return ((chainTime % windowSeconds) + windowSeconds) % windowSeconds === 0n
    ? chainTime
    : chainTime -
        (((chainTime % windowSeconds) + windowSeconds) % windowSeconds);
}

export async function deriveBatchPolicyAddress(
  programAddress: Address,
  market: Address,
): Promise<Address> {
  const [policy] = await getProgramDerivedAddress({
    programAddress,
    seeds: [text.encode('batch-policy'), encodeAddress.encode(market)],
  });
  return policy;
}

export async function fetchBatchPolicy(input: {
  rpcUrl: string;
  programAddress: Address;
  market: Address;
}): Promise<PublicBatchPolicy | null> {
  const policyAddress = await deriveBatchPolicyAddress(
    input.programAddress,
    input.market,
  );
  const rpc = createSolanaRpc(input.rpcUrl);
  const account = parseBase64RpcAccount(
    policyAddress,
    (
      await rpc
        .getAccountInfo(policyAddress, {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send()
    ).value,
  );
  if (
    !account.exists ||
    account.programAddress !== input.programAddress ||
    account.data.length !== 59 ||
    !policyDiscriminator.every((value, index) => value === account.data[index])
  )
    return null;
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  const windowSeconds = view.getBigInt64(42, true);
  const lockSeconds = view.getBigInt64(50, true);
  if (
    view.getUint16(8, true) !== BATCH_VERSION ||
    decodeAddress.decode(account.data.slice(10, 42)) !== input.market ||
    windowSeconds < MIN_BATCH_WINDOW_SECONDS ||
    windowSeconds > MAX_BATCH_WINDOW_SECONDS ||
    lockSeconds < 60n ||
    lockSeconds > 300n
  )
    return null;
  return {
    address: policyAddress,
    market: input.market,
    windowSeconds: windowSeconds.toString(),
    lockSeconds: lockSeconds.toString(),
  };
}

export async function deriveBatchAddress(
  programAddress: Address,
  market: Address,
  windowStart: bigint,
): Promise<Address> {
  const [batch] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      text.encode('batch'),
      u16(BATCH_VERSION),
      encodeAddress.encode(market),
      i64(windowStart),
    ],
  });
  return batch;
}

export function decodePublicBatch(
  data: Uint8Array,
  batchAddress: string,
): PublicBatch | null {
  if (
    data.length !== BATCH_ACCOUNT_DATA_LENGTH ||
    !discriminator.every((value, index) => value === data[index])
  )
    return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(8, true) !== BATCH_VERSION) return null;
  const lockTag = data[82];
  if (lockTag !== 0 && lockTag !== 1) return null;
  const deadlineOffset = lockTag === 1 ? 91 : 83;
  const statusOffset = deadlineOffset + 8;
  const status =
    data[statusOffset] === 1
      ? 'open'
      : data[statusOffset] === 2
        ? 'locked'
        : data[statusOffset] === 3
          ? 'expired'
          : data[statusOffset] === 4
            ? 'settled'
            : null;
  const countOffset = statusOffset + 1;
  const count = view.getUint32(countOffset, true);
  if (
    !status ||
    count > MAX_BATCH_REQUESTS ||
    (status === 'locked' && (lockTag !== 1 || count === 0))
  )
    return null;
  const requests: string[] = [];
  for (let index = 0; index < count; index++)
    requests.push(
      decodeAddress.decode(
        data.slice(
          countOffset + 4 + index * 32,
          countOffset + 4 + (index + 1) * 32,
        ),
      ),
    );
  if (
    requests.some(
      (key, index) =>
        index > 0 &&
        compareAddressBytes(address(requests[index - 1]), address(key)) >= 0,
    )
  )
    return null;
  return {
    address: batchAddress,
    market: decodeAddress.decode(data.slice(10, 42)),
    windowStart: view.getBigInt64(42, true).toString(),
    windowEnd: view.getBigInt64(50, true).toString(),
    windowSeconds: view.getBigInt64(58, true).toString(),
    lockSeconds: view.getBigInt64(66, true).toString(),
    createdSlot: view.getBigUint64(74, true).toString(),
    lockSlot: lockTag === 1 ? view.getBigUint64(83, true).toString() : null,
    lockDeadline: view.getBigInt64(deadlineOffset, true).toString(),
    status,
    requests,
  };
}

export async function fetchBatch(input: {
  rpcUrl: string;
  programAddress: Address;
  batchAddress: string;
}): Promise<PublicBatch | null> {
  if (!isAddress(input.batchAddress)) return null;
  const rpc = createSolanaRpc(input.rpcUrl);
  const account = parseBase64RpcAccount(
    address(input.batchAddress),
    (
      await rpc
        .getAccountInfo(address(input.batchAddress), {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send()
    ).value,
  );
  if (!account.exists || account.programAddress !== input.programAddress)
    return null;
  const batch = decodePublicBatch(account.data, input.batchAddress);
  if (
    !batch ||
    BigInt(batch.windowSeconds) < MIN_BATCH_WINDOW_SECONDS ||
    BigInt(batch.windowSeconds) > MAX_BATCH_WINDOW_SECONDS ||
    BigInt(batch.lockSeconds) < 60n ||
    BigInt(batch.lockSeconds) > 300n ||
    batchWindowStart(BigInt(batch.windowStart), BigInt(batch.windowSeconds)) !==
      BigInt(batch.windowStart) ||
    batch.windowEnd !==
      (BigInt(batch.windowStart) + BigInt(batch.windowSeconds)).toString() ||
    batch.lockDeadline !==
      (BigInt(batch.windowEnd) + BigInt(batch.lockSeconds)).toString()
  )
    return null;
  const expected = await deriveBatchAddress(
    input.programAddress,
    address(batch.market),
    BigInt(batch.windowStart),
  );
  return expected === address(input.batchAddress) ? batch : null;
}

export async function openBatchInstruction(input: {
  programAddress: Address;
  caller: Address;
  market: Address;
  windowStart: bigint;
}): Promise<{ batch: Address; instruction: Instruction }> {
  const batch = await deriveBatchAddress(
    input.programAddress,
    input.market,
    input.windowStart,
  );
  const policy = await deriveBatchPolicyAddress(
    input.programAddress,
    input.market,
  );
  return {
    batch,
    instruction: {
      programAddress: input.programAddress,
      accounts: [
        { address: input.caller, role: AccountRole.WRITABLE_SIGNER },
        { address: input.market, role: AccountRole.READONLY },
        { address: policy, role: AccountRole.READONLY },
        { address: batch, role: AccountRole.WRITABLE },
        {
          address: address('11111111111111111111111111111111'),
          role: AccountRole.READONLY,
        },
      ],
      data: concat(
        await instructionDiscriminator('open_batch'),
        i64(input.windowStart),
      ),
    },
  };
}

export async function initializeBatchPolicyInstruction(input: {
  programAddress: Address;
  authority: Address;
  market: Address;
  windowSeconds: bigint;
  lockSeconds: bigint;
}): Promise<Instruction> {
  if (
    input.windowSeconds < MIN_BATCH_WINDOW_SECONDS ||
    input.windowSeconds > MAX_BATCH_WINDOW_SECONDS ||
    input.lockSeconds < 60n ||
    input.lockSeconds > 300n
  )
    throw new Error('invalid Batch policy');
  const policy = await deriveBatchPolicyAddress(
    input.programAddress,
    input.market,
  );
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.authority, role: AccountRole.WRITABLE_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      { address: policy, role: AccountRole.WRITABLE },
      {
        address: address('11111111111111111111111111111111'),
        role: AccountRole.READONLY,
      },
    ],
    data: concat(
      await instructionDiscriminator('initialize_batch_policy'),
      i64(input.windowSeconds),
      i64(input.lockSeconds),
    ),
  };
}

export async function lockBatchInstruction(input: {
  programAddress: Address;
  caller: Address;
  market: Address;
  batch: Address;
  requests: { request: Address; escrow: Address }[];
}): Promise<Instruction> {
  if (
    input.requests.length === 0 ||
    input.requests.length > MAX_BATCH_REQUESTS ||
    input.requests.some(
      (entry, index) =>
        index > 0 &&
        compareAddressBytes(input.requests[index - 1].request, entry.request) >=
          0,
    )
  )
    throw new Error('invalid batch request set');
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.caller, role: AccountRole.READONLY_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      { address: input.batch, role: AccountRole.WRITABLE },
      ...input.requests.flatMap(entry => [
        { address: entry.request, role: AccountRole.WRITABLE },
        { address: entry.escrow, role: AccountRole.READONLY },
      ]),
    ],
    data: concat(
      await instructionDiscriminator('lock_batch'),
      u32(input.requests.length),
      ...input.requests.map(entry =>
        Uint8Array.from(encodeAddress.encode(entry.request)),
      ),
    ),
  };
}

export async function expireBatchInstruction(input: {
  programAddress: Address;
  caller: Address;
  batch: PublicBatch;
}): Promise<Instruction> {
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.caller, role: AccountRole.READONLY_SIGNER },
      { address: address(input.batch.address), role: AccountRole.WRITABLE },
      ...input.batch.requests.map(request => ({
        address: address(request),
        role: AccountRole.WRITABLE,
      })),
    ],
    data: await instructionDiscriminator('expire_batch'),
  };
}

export function compareAddressBytes(a: Address, b: Address): number {
  const left = encodeAddress.encode(a);
  const right = encodeAddress.encode(b);
  for (let index = 0; index < 32; index++)
    if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

async function instructionDiscriminator(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', text.encode(`global:${name}`)),
  ).slice(0, 8);
}
function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}
function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
function i64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, value, true);
  return result;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
