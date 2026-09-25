#!/usr/bin/env node

const { webcrypto } = require('node:crypto');
const anchor = require('@anchor-lang/core');
const idl = require('../target/idl/bazo.json');

const DEVNET_RPC_URL = process.env.SOLANA_RPC_URL;
if (process.env.SOLANA_NETWORK !== 'devnet' || !DEVNET_RPC_URL) throw new Error('Configured Devnet RPC is required');
const MARKET = new anchor.web3.PublicKey('H83inusRWiShJZsVT3rTFXafo1wSCgb5HKTJEsM2LRgu');
const QUOTE_MINT = new anchor.web3.PublicKey('EDJpD3ngqiy5ZhWZjDNYZDzCuTvkW42ea72X6TAuDeL3');
const STOCK_MINT = new anchor.web3.PublicKey('3bEb8QPW7edXzvcm1udGcRjr6NfpbvyXrwAdK5upXUTQ');
const RECIPIENT_STOCK_ACCOUNT = new anchor.web3.PublicKey('6qxP3oSzZRfAC3eekfVF8ptXh392nsSsPfLZQszMnDRJ');
const BUYER_QUOTE_ACCOUNT = new anchor.web3.PublicKey('ACFropKYtyPiD1amyb4Z4hrTDYUyWTMVFinpfvq9a3Qr');
const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

async function main() {
  const provider = anchor.AnchorProvider.local(DEVNET_RPC_URL);
  const program = new anchor.Program(idl, provider);
  if (process.argv[2] === '--cancel' || process.argv[2] === '--refund') {
    const action = process.argv[2] === '--refund' ? 'refund' : 'cancel';
    const request = new anchor.web3.PublicKey(process.argv[3]);
    const state = await program.account.buyRequest.fetch(request);
    if (!state.buyer.equals(provider.wallet.publicKey) || !state.market.equals(MARKET)) throw new Error('request identity mismatch');
    const escrow = state.escrow;
    const beforeEscrow = await provider.connection.getTokenAccountBalance(escrow);
    const beforeBuyer = await provider.connection.getTokenAccountBalance(BUYER_QUOTE_ACCOUNT);
    console.log(`${action} review: Devnet, fee payer ${provider.wallet.publicKey.toBase58()}, return ${beforeEscrow.value.amount} raw quote units from ${escrow.toBase58()} to ${BUYER_QUOTE_ACCOUNT.toBase58()}`);
    const createMethod = () => action === 'refund' ? program.methods.refundBuyRequest() : program.methods.cancelBuyRequest();
    const operation = createMethod().accounts({
      buyer: provider.wallet.publicKey, request, market: MARKET, quoteMint: QUOTE_MINT,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID, escrow, buyerQuoteDestination: BUYER_QUOTE_ACCOUNT,
    });
    await expectSimulationFailure(createMethod().accounts({
      buyer: provider.wallet.publicKey, request, market: MARKET, quoteMint: QUOTE_MINT,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID, escrow, buyerQuoteDestination: RECIPIENT_STOCK_ACCOUNT,
    }), 'substituted quote destination');
    const nonOwner = anchor.web3.Keypair.generate();
    await expectSimulationFailure(createMethod().accounts({
      buyer: nonOwner.publicKey, request, market: MARKET, quoteMint: QUOTE_MINT,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID, escrow, buyerQuoteDestination: BUYER_QUOTE_ACCOUNT,
    }).signers([nonOwner]), 'non-owner recovery');
    await operation.simulate();
    const signature = await operation.rpc();
    const [afterState, afterEscrow, afterBuyer] = await Promise.all([
      program.account.buyRequest.fetch(request), provider.connection.getTokenAccountBalance(escrow),
      provider.connection.getTokenAccountBalance(BUYER_QUOTE_ACCOUNT),
    ]);
    if (afterState.status !== (action === 'refund' ? 3 : 2) || BigInt(afterEscrow.value.amount) !== 0n || BigInt(afterBuyer.value.amount) - BigInt(beforeBuyer.value.amount) !== BigInt(beforeEscrow.value.amount)) throw new Error(`${action} reconciliation failed`);
    console.log(`Buy Request ${action === 'refund' ? 'refunded' : 'canceled'}: ${signature}`);
    console.log(`Returned quote raw units: ${beforeEscrow.value.amount}`);
    return;
  }
  const nonce = randomU64();
  const [request] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('buy-request'), u16(1), provider.wallet.publicKey.toBuffer(), u64(nonce)],
    program.programId,
  );
  const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('buy-escrow'), request.toBuffer()],
    program.programId,
  );
  const expirySeconds = process.argv[2] === '--expiry-seconds' ? Number(process.argv[3]) : 3_600;
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds < 15 || expirySeconds > 86_400) throw new Error('invalid fixture expiry');
  const expiresAt = BigInt(Math.floor(Date.now() / 1_000) + expirySeconds);
  const commitment = await sha256(Buffer.concat([
    Buffer.from('BAZO_BUY_REQUEST_V1'), u16(1), Buffer.of(1), request.toBuffer(),
    provider.wallet.publicKey.toBuffer(), provider.wallet.publicKey.toBuffer(), MARKET.toBuffer(),
    u64(1_000_000n), i32(100), u64(10_000_000n), i64(expiresAt), Buffer.of(1), u64(nonce), randomBytes(32),
  ]));
  const args = {
    requestNonce: new anchor.BN(nonce.toString()), requestCommitment: [...commitment],
    maxQuoteAmount: new anchor.BN(10_000_000), expiresAt: new anchor.BN(expiresAt.toString()),
    recipient: provider.wallet.publicKey, commitmentSchemaVersion: 1,
  };
  const accounts = {
    buyer: provider.wallet.publicKey, market: MARKET, stockMint: STOCK_MINT, quoteMint: QUOTE_MINT,
    stockTokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    buyerQuoteAccount: BUYER_QUOTE_ACCOUNT, recipientStockAccount: RECIPIENT_STOCK_ACCOUNT,
    request, escrow, systemProgram: anchor.web3.SystemProgram.programId,
  };
  await expectSimulationFailure(program.methods.createBuyRequest(args).accounts({ ...accounts, recipientStockAccount: BUYER_QUOTE_ACCOUNT }), 'substituted stock recipient');
  await expectSimulationFailure(program.methods.createBuyRequest(args).accounts({ ...accounts, buyerQuoteAccount: RECIPIENT_STOCK_ACCOUNT }), 'substituted quote source');
  const operation = program.methods.createBuyRequest(args).accounts(accounts);
  await operation.simulate();
  const signature = await operation.rpc();
  const [state, fundedEscrow] = await Promise.all([
    program.account.buyRequest.fetch(request), provider.connection.getTokenAccountBalance(escrow),
  ]);
  if (state.status !== 1 || !state.recipient.equals(provider.wallet.publicKey) || BigInt(fundedEscrow.value.amount) !== 10_000_000n) throw new Error('creation reconciliation failed');
  console.log(`Buy Request created: ${signature}`);
  console.log(`Request: ${request.toBase58()}`);
  console.log(`Escrow: ${escrow.toBase58()}`);
}

function randomBytes(length) { const bytes = new Uint8Array(length); webcrypto.getRandomValues(bytes); return Buffer.from(bytes); }
function randomU64() { const bytes = randomBytes(8); const value = bytes.readBigUInt64LE(); return value === 0n ? randomU64() : value; }
async function sha256(value) { return Buffer.from(await webcrypto.subtle.digest('SHA-256', value)); }
function u16(value) { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; }
function i32(value) { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes; }
function u64(value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; }
function i64(value) { const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(BigInt(value)); return bytes; }
async function expectSimulationFailure(operation, label) {
  try { await operation.simulate(); } catch { console.log(`Rejected ${label} in simulation.`); return; }
  throw new Error(`Unsafe ${label} unexpectedly simulated successfully`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
