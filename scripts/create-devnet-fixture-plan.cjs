#!/usr/bin/env node

const { webcrypto } = require('node:crypto');
const anchor = require('@anchor-lang/core');
const idl = require('../target/idl/bazo.json');

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
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
  const value = new DataView(randomBytes(8).buffer).getBigUint64(0, true);
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
