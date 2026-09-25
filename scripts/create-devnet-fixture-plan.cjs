#!/usr/bin/env node

const { webcrypto } = require('node:crypto');
const anchor = require('@anchor-lang/core');
const idl = require('../target/idl/bazo.json');

const DEVNET_RPC_URL = process.env.SOLANA_RPC_URL;
if (process.env.SOLANA_NETWORK !== 'devnet' || !DEVNET_RPC_URL)
  throw new Error('Configured Devnet RPC is required');
const PROGRAM_ID = new anchor.web3.PublicKey(idl.address);
const MARKET = new anchor.web3.PublicKey(
  'H83inusRWiShJZsVT3rTFXafo1wSCgb5HKTJEsM2LRgu',
);
const STOCK_MINT = new anchor.web3.PublicKey(
  '3bEb8QPW7edXzvcm1udGcRjr6NfpbvyXrwAdK5upXUTQ',
);
const QUOTE_MINT = new anchor.web3.PublicKey(
  'EDJpD3ngqiy5ZhWZjDNYZDzCuTvkW42ea72X6TAuDeL3',
);
const STOCK_SOURCE = new anchor.web3.PublicKey(
  '6qxP3oSzZRfAC3eekfVF8ptXh392nsSsPfLZQszMnDRJ',
);
const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

async function main() {
  const provider = anchor.AnchorProvider.local(DEVNET_RPC_URL);
  const program = new anchor.Program(idl, provider);
  const stockBefore = await tokenAmount(provider, STOCK_SOURCE);
  const nonce = randomU64();
  const [plan] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('plan'), u16(1), provider.wallet.publicKey.toBuffer(), u64(nonce)],
    PROGRAM_ID,
  );
  const [stockVault] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('plan-stock-vault'), plan.toBuffer()],
    PROGRAM_ID,
  );
  const [proceedsVault] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('plan-proceeds-vault'), plan.toBuffer()],
    PROGRAM_ID,
  );
  const commitment = await buildTwoStageCommitment(plan, MARKET);
  const signature = await program.methods
    .createPlan({
      planNonce: new anchor.BN(nonce.toString()),
      currentStageCommitment: [...commitment],
      initialRawInventory: new anchor.BN(10_000_000),
      expiresAt: new anchor.BN(Math.floor(Date.now() / 1_000) + 86_400),
      commitmentSchemaVersion: 1,
    })
    .accounts({
      owner: provider.wallet.publicKey,
      market: MARKET,
      stockMint: STOCK_MINT,
      quoteMint: QUOTE_MINT,
      stockTokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
      ownerStockAccount: STOCK_SOURCE,
      plan,
      stockVault,
      proceedsVault,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`Plan created: ${signature}`);
  console.log(`Plan: ${plan.toBase58()}`);
  console.log(`Stock vault: ${stockVault.toBase58()}`);
  console.log(`Proceeds vault: ${proceedsVault.toBase58()}`);
  if (process.argv.includes('--exercise-exit')) {
    const [reservation] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('plan-reservation'), plan.toBuffer(), u16(0)],
      PROGRAM_ID,
    );
    const cancel = () =>
      program.methods.cancelPlan().accountsPartial({
        owner: provider.wallet.publicKey,
        plan,
        market: MARKET,
        reservation,
      });
    const nonOwner = anchor.web3.Keypair.generate();
    await expectSimulationFailure(
      program.methods.cancelPlan().accountsPartial({
        owner: nonOwner.publicKey,
        plan,
        market: MARKET,
        reservation,
      }).signers([nonOwner]),
      'non-owner Plan cancellation',
    );
    await cancel().simulate();
    const cancelSignature = await cancel().rpc();
    const canceled = await program.account.plan.fetch(plan);
    if (canceled.status !== 2 || !canceled.soldRawInventory.isZero() ||
        !canceled.quoteProceedsAccrued.isZero() ||
        !canceled.remainingRawInventory.eq(new anchor.BN(10_000_000)))
      throw new Error('Plan cancellation accounting mismatch');
    await expectSimulationFailure(cancel(), 'duplicate Plan cancellation');
    console.log(`Plan canceled: ${cancelSignature}`);

    const withdraw = () =>
      program.methods.withdrawRemainingStock().accountsPartial({
        owner: provider.wallet.publicKey,
        plan,
        market: MARKET,
        stockMint: STOCK_MINT,
        stockTokenProgram: TOKEN_2022_PROGRAM_ID,
        stockVault,
        ownerStockDestination: STOCK_SOURCE,
        reservation,
      });
    await withdraw().simulate();
    const returnSignature = await withdraw().rpc();
    const returned = await program.account.plan.fetch(plan);
    if (!returned.remainingRawInventory.isZero() ||
        await tokenAmount(provider, stockVault) !== 0n ||
        await tokenAmount(provider, STOCK_SOURCE) !== stockBefore)
      throw new Error('Stock return accounting mismatch');
    await expectSimulationFailure(withdraw(), 'duplicate stock return');
    console.log(`Stock returned: ${returnSignature}`);
  }
}

async function tokenAmount(provider, tokenAccount) {
  return BigInt(
    (await provider.connection.getTokenAccountBalance(tokenAccount, 'confirmed'))
      .value.amount,
  );
}

async function expectSimulationFailure(operation, label) {
  try {
    await operation.simulate();
  } catch {
    console.log(`Rejected ${label} in simulation.`);
    return;
  }
  throw new Error(`${label} unexpectedly simulated successfully`);
}

async function buildTwoStageCommitment(plan, market) {
  let next = await sha256(
    Buffer.concat([Buffer.from('BAZO_STAGE_TERMINAL_V1'), Buffer.of(1), plan.toBuffer(), market.toBuffer()]),
  );
  for (let index = 1; index >= 0; index -= 1) {
    const rawQuantity = 5_000_000n;
    const minimumPremiumBps = index === 0 ? 50 : 100;
    next = await sha256(
      Buffer.concat([
        Buffer.from('BAZO_STAGE_V1'),
        u16(1),
        Buffer.of(1),
        plan.toBuffer(),
        market.toBuffer(),
        u16(index),
        u64(rawQuantity),
        i32(minimumPremiumBps),
        Buffer.of(1),
        u32(90),
        next,
        randomBytes(32),
      ]),
    );
  }
  return next;
}

function randomU64() {
  const bytes = randomBytes(8);
  const value = bytes.readBigUInt64LE();
  return value === 0n ? randomU64() : value;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

async function sha256(value) {
  return Buffer.from(await webcrypto.subtle.digest('SHA-256', value));
}

function u16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function i32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
