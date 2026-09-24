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
import { MAX_BATCH_REQUESTS } from './batch';

const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

const encoder = new TextEncoder();
const encodeAddress = getAddressEncoder();
const decodeAddress = getBase58Decoder();
const MAX_U64 = (1n << 64n) - 1n;
const policyDiscriminator = Uint8Array.of(143, 79, 122, 164, 45, 174, 137, 242);
const outcomeDiscriminator = Uint8Array.of(
  67,
  29,
  181,
  197,
  205,
  141,
  248,
  172,
);
const receiptDiscriminator = Uint8Array.of(52, 249, 252, 121, 4, 232, 187, 4);
const reservationDiscriminator = Uint8Array.of(
  69,
  74,
  147,
  224,
  46,
  246,
  232,
  116,
);

export type StageExecution = {
  rawQuantity: bigint;
  minPremiumBps: number;
  allowedSessionMask: number;
  maxReferenceAgeSeconds: number;
  nextCommitment: Uint8Array;
  salt: Uint8Array;
};

export type RequestExecution = {
  request: Address;
  escrow: Address;
  recipientStockAccount: Address;
  targetRawQuantity: bigint;
  maxPremiumBps: number;
  allowPartialFills: boolean;
  salt: Uint8Array;
};

export type SettlementAccounts = {
  programAddress: Address;
  caller: Address;
  market: Address;
  plan: Address;
  batch: Address;
  stockMint: Address;
  quoteMint: Address;
  stockVault: Address;
  proceedsVault: Address;
  stockTokenProgram: Address;
  quoteTokenProgram: Address;
  pythProgram: Address;
  pythStorage: Address;
  pythTreasury: Address;
  stageIndex: number;
  stage: StageExecution;
  requests: RequestExecution[];
  signedReference: Uint8Array;
};

export type PublicSettlementPolicy = {
  address: Address;
  market: Address;
  minimumPublisherCount: number;
  maximumConfidenceRatioBps: number;
  reservationAuthority: Address;
};

export type PublicPlanReservation = {
  address: Address;
  plan: Address;
  batch: Address;
  stageIndex: number;
  lockDeadline: string;
};

export type PublicBatchOutcome = {
  address: Address;
  batch: Address;
  plan: Address;
  receipt: Address;
};

export type PublicSettlementReceipt = {
  address: Address;
  market: Address;
  batch: Address;
  plan: Address;
  stageIndex: number;
  rawStockQuantity: string;
  rawQuoteQuantity: string;
  clearingPremiumBps: number;
  referencePrice: string;
  referenceExponent: number;
  referenceConfidence: string;
  referencePublisherCount: number;
  referenceSessionMask: number;
  pythFeedId: string;
  feedUpdateTimestampUs: string;
  executedAt: string;
  fills: {
    request: Address;
    rawStockQuantity: string;
    rawQuoteCharge: string;
  }[];
};

export async function deriveSettlementPolicyAddress(
  programAddress: Address,
  market: Address,
): Promise<Address> {
  return derive(programAddress, [
    encoder.encode('settlement-policy'),
    new Uint8Array(encodeAddress.encode(market)),
  ]);
}

export async function derivePlanReservationAddress(
  programAddress: Address,
  plan: Address,
  stageIndex: number,
): Promise<Address> {
  return derive(programAddress, [
    encoder.encode('plan-reservation'),
    new Uint8Array(encodeAddress.encode(plan)),
    u16(stageIndex),
  ]);
}

export async function deriveSaleReceiptAddress(
  programAddress: Address,
  plan: Address,
  stageIndex: number,
): Promise<Address> {
  return derive(programAddress, [
    encoder.encode('sale-receipt'),
    new Uint8Array(encodeAddress.encode(plan)),
    u16(stageIndex),
  ]);
}

export async function deriveBatchOutcomeAddress(
  programAddress: Address,
  batch: Address,
): Promise<Address> {
  return derive(programAddress, [
    encoder.encode('batch-outcome'),
    new Uint8Array(encodeAddress.encode(batch)),
  ]);
}

export async function initializeSettlementPolicyInstruction(input: {
  programAddress: Address;
  authority: Address;
  market: Address;
  minimumPublisherCount: number;
  maximumConfidenceRatioBps: number;
  reservationAuthority: Address;
}): Promise<Instruction> {
  if (
    !Number.isInteger(input.minimumPublisherCount) ||
    input.minimumPublisherCount < 1 ||
    input.minimumPublisherCount > 65535 ||
    !Number.isInteger(input.maximumConfidenceRatioBps) ||
    input.maximumConfidenceRatioBps < 1 ||
    input.maximumConfidenceRatioBps > 10_000
  )
    throw new Error('invalid settlement policy');
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.authority, role: AccountRole.WRITABLE_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      {
        address: await deriveSettlementPolicyAddress(
          input.programAddress,
          input.market,
        ),
        role: AccountRole.WRITABLE,
      },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: concat(
      await discriminator('initialize_settlement_policy'),
      u16(input.minimumPublisherCount),
      u32(input.maximumConfidenceRatioBps),
      new Uint8Array(encodeAddress.encode(input.reservationAuthority)),
    ),
  };
}

export async function reservePlanInstruction(input: {
  programAddress: Address;
  caller: Address;
  market: Address;
  plan: Address;
  batch: Address;
  stageIndex: number;
}): Promise<Instruction> {
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.caller, role: AccountRole.WRITABLE_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      {
        address: await deriveSettlementPolicyAddress(
          input.programAddress,
          input.market,
        ),
        role: AccountRole.READONLY,
      },
      { address: input.plan, role: AccountRole.READONLY },
      { address: input.batch, role: AccountRole.READONLY },
      {
        address: await derivePlanReservationAddress(
          input.programAddress,
          input.plan,
          input.stageIndex,
        ),
        role: AccountRole.WRITABLE,
      },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: await discriminator('reserve_plan'),
  };
}

export async function releasePlanReservationInstruction(input: {
  programAddress: Address;
  caller: Address;
  plan: Address;
  stageIndex: number;
}): Promise<Instruction> {
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.caller, role: AccountRole.WRITABLE_SIGNER },
      { address: input.plan, role: AccountRole.READONLY },
      {
        address: await derivePlanReservationAddress(
          input.programAddress,
          input.plan,
          input.stageIndex,
        ),
        role: AccountRole.WRITABLE,
      },
    ],
    data: await discriminator('release_plan_reservation'),
  };
}

export async function settlementInstructions(
  input: SettlementAccounts,
): Promise<{
  ed25519Instruction: Instruction;
  settlementInstruction: Instruction;
  receipt: Address;
  outcome: Address;
}> {
  if (
    input.requests.length < 1 ||
    input.requests.length > MAX_BATCH_REQUESTS ||
    input.stage.nextCommitment.length !== 32 ||
    input.stage.salt.length !== 32 ||
    input.signedReference.length < 102 ||
    input.signedReference.length > 1024 ||
    input.stage.rawQuantity < 1n ||
    input.stage.rawQuantity > MAX_U64 ||
    input.requests.some(
      request =>
        request.salt.length !== 32 ||
        request.targetRawQuantity < 1n ||
        request.targetRawQuantity > MAX_U64,
    )
  )
    throw new Error('invalid settlement input');
  const signedView = new DataView(
    input.signedReference.buffer,
    input.signedReference.byteOffset,
    input.signedReference.byteLength,
  );
  if (
    signedView.getUint32(0, true) !== 2_182_742_457 ||
    signedView.getUint16(100, true) !== input.signedReference.length - 102
  )
    throw new Error('invalid signed reference envelope');

  const receipt = await deriveSaleReceiptAddress(
    input.programAddress,
    input.plan,
    input.stageIndex,
  );
  const outcome = await deriveBatchOutcomeAddress(
    input.programAddress,
    input.batch,
  );
  const data = concat(
    await discriminator('settle_stage'),
    u64(input.stage.rawQuantity),
    i32(input.stage.minPremiumBps),
    Uint8Array.of(input.stage.allowedSessionMask),
    u32(input.stage.maxReferenceAgeSeconds),
    input.stage.nextCommitment,
    input.stage.salt,
    u32(input.requests.length),
    ...input.requests.map(request =>
      concat(
        u64(request.targetRawQuantity),
        i32(request.maxPremiumBps),
        Uint8Array.of(request.allowPartialFills ? 1 : 0),
        request.salt,
      ),
    ),
    u32(input.signedReference.length),
    input.signedReference,
  );
  const signedOffset = data.length - input.signedReference.length;
  const ed25519Data = new Uint8Array(16);
  const ed25519View = new DataView(ed25519Data.buffer);
  ed25519Data[0] = 1;
  ed25519View.setUint16(2, signedOffset + 4, true);
  ed25519View.setUint16(4, 1, true);
  ed25519View.setUint16(6, signedOffset + 68, true);
  ed25519View.setUint16(8, 1, true);
  ed25519View.setUint16(10, signedOffset + 102, true);
  ed25519View.setUint16(12, input.signedReference.length - 102, true);
  ed25519View.setUint16(14, 1, true);
  return {
    ed25519Instruction: {
      programAddress: address('Ed25519SigVerify111111111111111111111111111'),
      accounts: [],
      data: ed25519Data,
    },
    settlementInstruction: {
      programAddress: input.programAddress,
      accounts: [
        { address: input.caller, role: AccountRole.WRITABLE_SIGNER },
        { address: input.market, role: AccountRole.READONLY },
        {
          address: await deriveSettlementPolicyAddress(
            input.programAddress,
            input.market,
          ),
          role: AccountRole.READONLY,
        },
        { address: input.plan, role: AccountRole.WRITABLE },
        {
          address: await derivePlanReservationAddress(
            input.programAddress,
            input.plan,
            input.stageIndex,
          ),
          role: AccountRole.WRITABLE,
        },
        { address: input.batch, role: AccountRole.WRITABLE },
        { address: receipt, role: AccountRole.WRITABLE },
        { address: outcome, role: AccountRole.WRITABLE },
        { address: input.stockMint, role: AccountRole.READONLY },
        { address: input.quoteMint, role: AccountRole.READONLY },
        { address: input.stockVault, role: AccountRole.WRITABLE },
        { address: input.proceedsVault, role: AccountRole.WRITABLE },
        { address: input.stockTokenProgram, role: AccountRole.READONLY },
        { address: input.quoteTokenProgram, role: AccountRole.READONLY },
        { address: input.pythProgram, role: AccountRole.READONLY },
        { address: input.pythStorage, role: AccountRole.READONLY },
        { address: input.pythTreasury, role: AccountRole.WRITABLE },
        {
          address: address('Sysvar1nstructions1111111111111111111111111'),
          role: AccountRole.READONLY,
        },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ...input.requests.flatMap(request => [
          { address: request.request, role: AccountRole.WRITABLE },
          { address: request.escrow, role: AccountRole.WRITABLE },
          {
            address: request.recipientStockAccount,
            role: AccountRole.WRITABLE,
          },
        ]),
      ],
      data,
    },
    receipt,
    outcome,
  };
}

export async function fetchSettlementPolicy(input: {
  rpcUrl: string;
  programAddress: Address;
  market: Address;
}): Promise<PublicSettlementPolicy | null> {
  const key = await deriveSettlementPolicyAddress(
    input.programAddress,
    input.market,
  );
  const bytes = await fetchOwnedAccount(
    input.rpcUrl,
    input.programAddress,
    key,
    81,
    policyDiscriminator,
  );
  if (!bytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const market = decodeAddress.decode(bytes.slice(10, 42));
  const minimumPublisherCount = view.getUint16(42, true);
  const maximumConfidenceRatioBps = view.getUint32(44, true);
  if (
    view.getUint16(8, true) !== 1 ||
    market !== input.market ||
    minimumPublisherCount < 1 ||
    maximumConfidenceRatioBps < 1 ||
    maximumConfidenceRatioBps > 10_000
  )
    return null;
  return {
    address: key,
    market: address(market),
    minimumPublisherCount,
    maximumConfidenceRatioBps,
    reservationAuthority: address(decodeAddress.decode(bytes.slice(48, 80))),
  };
}

export async function fetchPlanReservation(input: {
  rpcUrl: string;
  programAddress: Address;
  plan: Address;
  stageIndex: number;
}): Promise<PublicPlanReservation | null> {
  const key = await derivePlanReservationAddress(
    input.programAddress,
    input.plan,
    input.stageIndex,
  );
  const bytes = await fetchOwnedAccount(
    input.rpcUrl,
    input.programAddress,
    key,
    85,
    reservationDiscriminator,
  );
  if (!bytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const plan = address(decodeAddress.decode(bytes.slice(10, 42)));
  if (
    view.getUint16(8, true) !== 1 ||
    plan !== input.plan ||
    view.getUint16(74, true) !== input.stageIndex
  )
    return null;
  return {
    address: key,
    plan,
    batch: address(decodeAddress.decode(bytes.slice(42, 74))),
    stageIndex: input.stageIndex,
    lockDeadline: view.getBigInt64(76, true).toString(),
  };
}

export async function fetchBatchOutcome(input: {
  rpcUrl: string;
  programAddress: Address;
  batch: Address;
}): Promise<PublicBatchOutcome | null> {
  const key = await deriveBatchOutcomeAddress(
    input.programAddress,
    input.batch,
  );
  const bytes = await fetchOwnedAccount(
    input.rpcUrl,
    input.programAddress,
    key,
    107,
    outcomeDiscriminator,
  );
  if (
    !bytes ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
      8,
      true,
    ) !== 1
  )
    return null;
  const batch = decodeAddress.decode(bytes.slice(10, 42));
  if (batch !== input.batch) return null;
  return {
    address: key,
    batch: input.batch,
    plan: address(decodeAddress.decode(bytes.slice(42, 74))),
    receipt: address(decodeAddress.decode(bytes.slice(74, 106))),
  };
}

export async function fetchSaleReceipt(input: {
  rpcUrl: string;
  programAddress: Address;
  plan: Address;
  stageIndex: number;
}): Promise<PublicSettlementReceipt | null> {
  const key = await deriveSaleReceiptAddress(
    input.programAddress,
    input.plan,
    input.stageIndex,
  );
  const receipt = await fetchSaleReceiptAtAddress({ ...input, receipt: key });
  return receipt?.plan === input.plan && receipt.stageIndex === input.stageIndex
    ? receipt
    : null;
}

export async function fetchSaleReceiptAtAddress(input: {
  rpcUrl: string;
  programAddress: Address;
  receipt: Address;
}): Promise<PublicSettlementReceipt | null> {
  const bytes = await fetchOwnedAccount(
    input.rpcUrl,
    input.programAddress,
    input.receipt,
    367,
    receiptDiscriminator,
  );
  if (!bytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const market = address(decodeAddress.decode(bytes.slice(10, 42)));
  const batch = address(decodeAddress.decode(bytes.slice(42, 74)));
  const plan = address(decodeAddress.decode(bytes.slice(74, 106)));
  const stageIndex = view.getUint16(106, true);
  const count = bytes[173];
  if (
    view.getUint16(8, true) !== 1 ||
    (await deriveSaleReceiptAddress(input.programAddress, plan, stageIndex)) !==
      input.receipt ||
    count < 1 ||
    count > MAX_BATCH_REQUESTS
  )
    return null;
  const fills = Array.from({ length: count }, (_, index) => ({
    request: address(
      decodeAddress.decode(bytes.slice(174 + index * 32, 206 + index * 32)),
    ),
    rawStockQuantity: view.getBigUint64(302 + index * 8, true).toString(),
    rawQuoteCharge: view.getBigUint64(334 + index * 8, true).toString(),
  }));
  if (
    new Set(fills.map(fill => fill.request)).size !== count ||
    fills.reduce((sum, fill) => sum + BigInt(fill.rawStockQuantity), 0n) !==
      view.getBigUint64(108, true) ||
    fills.reduce((sum, fill) => sum + BigInt(fill.rawQuoteCharge), 0n) !==
      view.getBigUint64(116, true)
  )
    return null;
  return {
    address: input.receipt,
    market,
    batch,
    plan,
    stageIndex,
    rawStockQuantity: view.getBigUint64(108, true).toString(),
    rawQuoteQuantity: view.getBigUint64(116, true).toString(),
    clearingPremiumBps: view.getInt32(124, true),
    referencePrice: view.getBigInt64(128, true).toString(),
    referenceExponent: view.getInt16(136, true),
    referenceConfidence: view.getBigInt64(138, true).toString(),
    referencePublisherCount: view.getUint16(146, true),
    referenceSessionMask: bytes[148],
    pythFeedId: view.getBigUint64(149, true).toString(),
    feedUpdateTimestampUs: view.getBigUint64(157, true).toString(),
    executedAt: view.getBigInt64(165, true).toString(),
    fills,
  };
}

async function fetchOwnedAccount(
  rpcUrl: string,
  programAddress: Address,
  key: Address,
  length: number,
  expectedDiscriminator: Uint8Array,
): Promise<Uint8Array | null> {
  const rpc = createSolanaRpc(rpcUrl);
  const account = parseBase64RpcAccount(
    key,
    (
      await rpc
        .getAccountInfo(key, { encoding: 'base64', commitment: 'confirmed' })
        .send()
    ).value,
  );
  return account.exists &&
    account.programAddress === programAddress &&
    account.data.length === length &&
    expectedDiscriminator.every((value, index) => account.data[index] === value)
    ? account.data
    : null;
}

async function derive(
  programAddress: Address,
  seeds: Uint8Array[],
): Promise<Address> {
  const [key] = await getProgramDerivedAddress({ programAddress, seeds });
  return key;
}

async function discriminator(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(`global:${name}`)),
  ).slice(0, 8);
}

function u16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 65535)
    throw new Error('invalid u16');
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error('invalid u32');
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_U64) throw new Error('invalid u64');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function i32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff)
    throw new Error('invalid i32');
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
