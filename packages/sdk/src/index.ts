import {
  AccountRole,
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  isAddress,
  parseBase64RpcAccount,
  type Address,
  type Instruction,
} from '@solana/kit';
import {
  BUY_REQUEST_ACCOUNT_DATA_LENGTH,
  decodePublicBuyRequest,
  type PublicBuyRequest,
} from './buy-request';

export {
  BUY_REQUEST_ACCOUNT_DATA_LENGTH,
  decodePublicBuyRequest,
  type PublicBuyRequest,
} from './buy-request';

export const PLAN_VERSION = 1;
export const COMMITMENT_SCHEMA_VERSION = 1;
export const MARKET_SEED = 'market';
export const PLAN_SEED = 'plan';
export const STOCK_VAULT_SEED = 'plan-stock-vault';
export const PROCEEDS_VAULT_SEED = 'plan-proceeds-vault';
export const DEVNET_STOCK_FAUCET_SEED = 'devnet-stock-faucet';
export const DEVNET_STOCK_CLAIM_SEED = 'devnet-stock-claim';
export const BUY_REQUEST_VERSION = 1;
export const BUY_REQUEST_SEED = 'buy-request';
export const BUY_ESCROW_SEED = 'buy-escrow';
export const BUY_REQUEST_COMMITMENT_DOMAIN = 'BAZO_BUY_REQUEST_V1';
export const SYSTEM_PROGRAM_ADDRESS = address(
  '11111111111111111111111111111111',
);

const encoder = new TextEncoder();
const addressEncoder = getAddressEncoder();

export type MarketAddresses = {
  stockMint: Address;
  quoteMint: Address;
};

export type PlanAddresses = {
  market: Address;
  plan: Address;
  stockVault: Address;
  proceedsVault: Address;
};

export type CreateSellPlanInput = {
  programAddress: Address;
  owner: Address;
  sourceStockAccount: Address;
  market: Address;
  stockMint: Address;
  quoteMint: Address;
  stockTokenProgram: Address;
  quoteTokenProgram: Address;
  planNonce: bigint;
  currentStageCommitment: Uint8Array;
  initialRawInventory: bigint;
  expiresAt: bigint;
};

export type PreparedSellPlanTransaction = Pick<
  PlanAddresses,
  'plan' | 'stockVault' | 'proceedsVault'
> & {
  instruction: Instruction;
};

export type DevnetStockClaimAddresses = {
  faucetAuthority: Address;
  claim: Address;
};

export type BuyRequestAddresses = { request: Address; escrow: Address };

export type BuyRequestOpeningV1 = {
  schemaVersion: 1;
  network: 1;
  request: Address;
  buyer: Address;
  recipient: Address;
  market: Address;
  targetRawQuantity: bigint;
  maxPremiumBps: number;
  maxQuoteAmount: bigint;
  expiresAt: bigint;
  allowPartialFills: boolean;
  requestNonce: bigint;
  salt: Uint8Array;
};

export type CreateBuyRequestInput = {
  programAddress: Address;
  buyer: Address;
  recipient: Address;
  market: Address;
  stockMint: Address;
  quoteMint: Address;
  stockTokenProgram: Address;
  quoteTokenProgram: Address;
  buyerQuoteAccount: Address;
  recipientStockAccount: Address;
  requestNonce: bigint;
  requestCommitment: Uint8Array;
  maxQuoteAmount: bigint;
  expiresAt: bigint;
};

export type PreparedBuyRequestTransaction = BuyRequestAddresses & {
  instruction: Instruction;
  commitmentFingerprint: string;
};

export type CreateDevnetStockClaimInput = {
  programAddress: Address;
  recipient: Address;
  market: Address;
  stockMint: Address;
  stockTokenProgram: Address;
  recipientStockAccount: Address;
};

export async function deriveMarketAddress(
  programAddress: Address,
  addresses: MarketAddresses,
): Promise<Address> {
  const [market] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      encoder.encode(MARKET_SEED),
      addressEncoder.encode(addresses.stockMint),
      addressEncoder.encode(addresses.quoteMint),
    ],
  });
  return market;
}

export async function derivePlanAddresses(
  input: Pick<
    CreateSellPlanInput,
    'programAddress' | 'owner' | 'market' | 'planNonce'
  >,
): Promise<Pick<PlanAddresses, 'plan' | 'stockVault' | 'proceedsVault'>> {
  const [plan] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [
      encoder.encode(PLAN_SEED),
      u16(PLAN_VERSION),
      addressEncoder.encode(input.owner),
      u64(input.planNonce),
    ],
  });
  const [stockVault] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [encoder.encode(STOCK_VAULT_SEED), addressEncoder.encode(plan)],
  });
  const [proceedsVault] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [encoder.encode(PROCEEDS_VAULT_SEED), addressEncoder.encode(plan)],
  });
  return { plan, stockVault, proceedsVault };
}

export async function deriveDevnetStockClaimAddresses(
  input: Pick<
    CreateDevnetStockClaimInput,
    'programAddress' | 'market' | 'recipient'
  >,
): Promise<DevnetStockClaimAddresses> {
  const [faucetAuthority] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [
      encoder.encode(DEVNET_STOCK_FAUCET_SEED),
      addressEncoder.encode(input.market),
    ],
  });
  const [claim] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [
      encoder.encode(DEVNET_STOCK_CLAIM_SEED),
      addressEncoder.encode(input.market),
      addressEncoder.encode(input.recipient),
    ],
  });
  return { faucetAuthority, claim };
}

export async function deriveBuyRequestAddresses(
  input: Pick<
    CreateBuyRequestInput,
    'programAddress' | 'buyer' | 'requestNonce'
  >,
): Promise<BuyRequestAddresses> {
  const [request] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [
      encoder.encode(BUY_REQUEST_SEED),
      u16(BUY_REQUEST_VERSION),
      addressEncoder.encode(input.buyer),
      u64(input.requestNonce),
    ],
  });
  const [escrow] = await getProgramDerivedAddress({
    programAddress: input.programAddress,
    seeds: [encoder.encode(BUY_ESCROW_SEED), addressEncoder.encode(request)],
  });
  return { request, escrow };
}

export async function fetchBuyRequest(input: {
  rpcUrl: string;
  programAddress: Address;
  requestAddress: string;
}): Promise<PublicBuyRequest | null> {
  if (!isAddress(input.requestAddress)) return null;
  const rpc = createSolanaRpc(input.rpcUrl);
  const account = parseBase64RpcAccount(
    address(input.requestAddress),
    (
      await rpc
        .getAccountInfo(address(input.requestAddress), { encoding: 'base64' })
        .send()
    ).value,
  );
  if (
    !account.exists ||
    account.programAddress !== input.programAddress ||
    account.data.length !== BUY_REQUEST_ACCOUNT_DATA_LENGTH
  )
    return null;
  const request = decodePublicBuyRequest(account.data, input.requestAddress);
  if (
    !request ||
    request.status === 'unknown' ||
    !isAddress(request.escrow) ||
    BigInt(request.spentQuoteAmount) > BigInt(request.maxQuoteAmount)
  )
    return null;
  const expected = await deriveBuyRequestAddresses({
    programAddress: input.programAddress,
    buyer: address(request.buyer),
    requestNonce: BigInt(request.requestNonce),
  });
  return expected.request === address(input.requestAddress) &&
    expected.escrow === address(request.escrow)
    ? request
    : null;
}

export function encodeBuyRequestOpening(
  opening: BuyRequestOpeningV1,
): Uint8Array {
  if (
    opening.schemaVersion !== 1 ||
    opening.network !== 1 ||
    opening.salt.length !== 32 ||
    opening.targetRawQuantity <= 0n ||
    opening.maxQuoteAmount <= 0n ||
    opening.expiresAt <= 0n ||
    !Number.isInteger(opening.maxPremiumBps) ||
    opening.maxPremiumBps <= -10_000
  ) {
    throw new Error('invalid Buy Request opening');
  }
  return concatBytes(
    encoder.encode(BUY_REQUEST_COMMITMENT_DOMAIN),
    u16(opening.schemaVersion),
    Uint8Array.of(opening.network),
    new Uint8Array(addressEncoder.encode(opening.request)),
    new Uint8Array(addressEncoder.encode(opening.buyer)),
    new Uint8Array(addressEncoder.encode(opening.recipient)),
    new Uint8Array(addressEncoder.encode(opening.market)),
    u64(opening.targetRawQuantity),
    i32(opening.maxPremiumBps),
    u64(opening.maxQuoteAmount),
    i64(opening.expiresAt),
    Uint8Array.of(opening.allowPartialFills ? 1 : 0),
    u64(opening.requestNonce),
    opening.salt,
  );
}

export async function hashBuyRequestOpening(
  opening: BuyRequestOpeningV1,
): Promise<Uint8Array> {
  const bytes = encodeBuyRequestOpening(opening);
  return new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ),
  );
}

export async function prepareBuyRequest(
  input: CreateBuyRequestInput,
): Promise<PreparedBuyRequestTransaction> {
  if (
    input.requestCommitment.length !== 32 ||
    input.maxQuoteAmount <= 0n ||
    input.expiresAt <= 0n
  )
    throw new Error('invalid Buy Request preparation');
  const addresses = await deriveBuyRequestAddresses(input);
  const data = concatBytes(
    await anchorDiscriminator('create_buy_request'),
    u64(input.requestNonce),
    input.requestCommitment,
    u64(input.maxQuoteAmount),
    i64(input.expiresAt),
    new Uint8Array(addressEncoder.encode(input.recipient)),
    u16(COMMITMENT_SCHEMA_VERSION),
  );
  return {
    ...addresses,
    commitmentFingerprint:
      toHex(input.requestCommitment.slice(0, 6)) +
      '…' +
      toHex(input.requestCommitment.slice(-4)),
    instruction: {
      programAddress: input.programAddress,
      accounts: [
        { address: input.buyer, role: AccountRole.WRITABLE_SIGNER },
        { address: input.market, role: AccountRole.READONLY },
        { address: input.stockMint, role: AccountRole.READONLY },
        { address: input.quoteMint, role: AccountRole.READONLY },
        { address: input.stockTokenProgram, role: AccountRole.READONLY },
        { address: input.quoteTokenProgram, role: AccountRole.READONLY },
        { address: input.buyerQuoteAccount, role: AccountRole.WRITABLE },
        { address: input.recipientStockAccount, role: AccountRole.READONLY },
        { address: addresses.request, role: AccountRole.WRITABLE },
        { address: addresses.escrow, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ],
      data,
    },
  };
}

export async function createBuyRequestInstruction(
  input: CreateBuyRequestInput,
): Promise<Instruction> {
  return (await prepareBuyRequest(input)).instruction;
}

export async function cancelBuyRequestInstruction(
  input: Pick<
    CreateBuyRequestInput,
    'programAddress' | 'buyer' | 'market' | 'quoteMint' | 'quoteTokenProgram'
  > &
    BuyRequestAddresses & { buyerQuoteDestination: Address },
): Promise<Instruction> {
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.request, role: AccountRole.WRITABLE },
      { address: input.market, role: AccountRole.READONLY },
      { address: input.quoteMint, role: AccountRole.READONLY },
      { address: input.quoteTokenProgram, role: AccountRole.READONLY },
      { address: input.escrow, role: AccountRole.WRITABLE },
      { address: input.buyerQuoteDestination, role: AccountRole.WRITABLE },
    ],
    data: await anchorDiscriminator('cancel_buy_request'),
  };
}

export async function refundBuyRequestInstruction(
  input: Pick<
    CreateBuyRequestInput,
    'programAddress' | 'buyer' | 'market' | 'quoteMint' | 'quoteTokenProgram'
  > &
    BuyRequestAddresses & { buyerQuoteDestination: Address },
): Promise<Instruction> {
  const instruction = await cancelBuyRequestInstruction(input);
  return {
    ...instruction,
    data: await anchorDiscriminator('refund_buy_request'),
  };
}

export async function createDevnetStockClaimInstruction(
  input: CreateDevnetStockClaimInput,
): Promise<Instruction> {
  const addresses = await deriveDevnetStockClaimAddresses(input);
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.recipient, role: AccountRole.WRITABLE_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      { address: input.stockMint, role: AccountRole.WRITABLE },
      { address: input.stockTokenProgram, role: AccountRole.READONLY },
      { address: input.recipientStockAccount, role: AccountRole.WRITABLE },
      { address: addresses.faucetAuthority, role: AccountRole.READONLY },
      { address: addresses.claim, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: await anchorDiscriminator('claim_devnet_stock'),
  };
}

export async function createSellPlanInstruction(
  input: CreateSellPlanInput,
): Promise<Instruction> {
  return (await prepareSellPlan(input)).instruction;
}

export async function prepareSellPlan(
  input: CreateSellPlanInput,
): Promise<PreparedSellPlanTransaction> {
  if (input.currentStageCommitment.length !== 32) {
    throw new Error('a Sell Plan needs a 32-byte commitment');
  }
  if (input.initialRawInventory <= 0n) {
    throw new Error('a Sell Plan needs a positive funded amount');
  }
  const addresses = await derivePlanAddresses(input);
  const discriminator = await anchorDiscriminator('create_plan');
  const data = concatBytes(
    discriminator,
    u64(input.planNonce),
    input.currentStageCommitment,
    u64(input.initialRawInventory),
    i64(input.expiresAt),
    u16(COMMITMENT_SCHEMA_VERSION),
  );
  const instruction = {
    programAddress: input.programAddress,
    accounts: [
      { address: input.owner, role: AccountRole.WRITABLE_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      { address: input.stockMint, role: AccountRole.READONLY },
      { address: input.quoteMint, role: AccountRole.READONLY },
      { address: input.stockTokenProgram, role: AccountRole.READONLY },
      { address: input.quoteTokenProgram, role: AccountRole.READONLY },
      { address: input.sourceStockAccount, role: AccountRole.WRITABLE },
      { address: addresses.plan, role: AccountRole.WRITABLE },
      { address: addresses.stockVault, role: AccountRole.WRITABLE },
      { address: addresses.proceedsVault, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data,
  };
  return { ...addresses, instruction };
}

async function anchorDiscriminator(name: string): Promise<Uint8Array> {
  const bytes = encoder.encode(`global:${name}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).slice(
    0,
    8,
  );
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function i64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function i32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    values.reduce((total, value) => total + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    bytes.set(value, offset);
    offset += value.length;
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(
    '',
  );
}
