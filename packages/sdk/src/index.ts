import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';

export const PLAN_VERSION = 1;
export const COMMITMENT_SCHEMA_VERSION = 1;
export const MARKET_SEED = 'market';
export const PLAN_SEED = 'plan';
export const STOCK_VAULT_SEED = 'plan-stock-vault';
export const PROCEEDS_VAULT_SEED = 'plan-proceeds-vault';
export const DEVNET_STOCK_FAUCET_SEED = 'devnet-stock-faucet';
export const DEVNET_STOCK_CLAIM_SEED = 'devnet-stock-claim';
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

export type PreparedSellPlanTransaction = Pick<PlanAddresses, 'plan' | 'stockVault' | 'proceedsVault'> & {
  instruction: Instruction;
};

export type DevnetStockClaimAddresses = {
  faucetAuthority: Address;
  claim: Address;
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
  input: Pick<CreateSellPlanInput, 'programAddress' | 'owner' | 'market' | 'planNonce'>,
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
  input: Pick<CreateDevnetStockClaimInput, 'programAddress' | 'market' | 'recipient'>,
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

export async function createDevnetStockClaimInstruction(
  input: CreateDevnetStockClaimInput,
): Promise<Instruction> {
  const addresses = await deriveDevnetStockClaimAddresses(input);
  return {
    programAddress: input.programAddress,
    accounts: [
      { address: input.recipient, role: AccountRole.WRITABLE_SIGNER },
      { address: input.market, role: AccountRole.READONLY },
      { address: input.stockMint, role: AccountRole.READONLY },
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
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 8);
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

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    bytes.set(value, offset);
    offset += value.length;
  }
  return bytes;
}
