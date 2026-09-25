import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as anchor from '@anchor-lang/core';
import { address } from '@solana/kit';
import {
  batchWindowStart,
  deriveBatchAddress,
  deriveBuyRequestAddresses,
  fetchBatch,
  fetchBuyRequest,
  hashBuyRequestOpening,
  parseBuyOpening,
  parseStageOpening,
  serializeOpening,
} from '@bazo/sdk';
import {
  buildCommitmentChain,
  randomPlanNonce,
  randomSalt,
} from '@bazo/plan-crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rpcUrl = required('SOLANA_RPC_URL');
const coordinatorSecret = required('BAZO_COORDINATOR_SECRET');
const coordinatorUrl = new URL(
  process.env.BAZO_COORDINATOR_URL ?? 'http://127.0.0.1:3145/',
);
const programId = new anchor.web3.PublicKey(required('BAZO_PROGRAM_ID'));
const stockMint = new anchor.web3.PublicKey(required('BAZO_STOCK_MINT'));
const quoteMint = new anchor.web3.PublicKey(required('BAZO_QUOTE_MINT'));
const tokenProgram = new anchor.web3.PublicKey(
  required('BAZO_STOCK_TOKEN_PROGRAM'),
);
const quoteTokenProgram = new anchor.web3.PublicKey(
  required('BAZO_QUOTE_TOKEN_PROGRAM'),
);
const associatedTokenProgram = new anchor.web3.PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
const [market] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from('market'), stockMint.toBuffer(), quoteMint.toBuffer()],
  programId,
);
const provider = anchor.AnchorProvider.local(rpcUrl);
const program = new anchor.Program(
  JSON.parse(readFileSync(resolve(root, 'target/idl/bazo.json'), 'utf8')),
  provider,
);
const owner = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(required('ANCHOR_WALLET'), 'utf8'))),
);
const buyerQuote = associatedAddress(
  owner.publicKey,
  quoteMint,
  quoteTokenProgram,
);
const buyerStock = associatedAddress(owner.publicKey, stockMint, tokenProgram);
const qaRecoveryRoot = resolve(root, 'target/devnet-qa');
mkdirSync(qaRecoveryRoot, { recursive: true, mode: 0o700 });
chmodSync(qaRecoveryRoot, 0o700);
const walletRecoveryDirectory =
  process.env.BAZO_QA_RECOVER_DIR ??
  mkdtempSync(resolve(qaRecoveryRoot, 'run-'));
if (!existsSync(walletRecoveryDirectory))
  throw new Error('QA recovery directory is missing');
chmodSync(walletRecoveryDirectory, 0o700);
const sellers = [1, 2].map(index => {
  const path = resolve(walletRecoveryDirectory, `seller-${index}.json`);
  if (existsSync(path))
    return anchor.web3.Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))),
    );
  const seller = anchor.web3.Keypair.generate();
  writeFileSync(path, JSON.stringify([...seller.secretKey]), { mode: 0o600 });
  return seller;
});
const requests = [];
let coordinator;
let lockedBatch;

try {
  if (process.env.BAZO_QA_CLEANUP_ONLY === '1') {
    await returnTemporarySol();
    rmSync(walletRecoveryDirectory, { recursive: true });
    process.stdout.write(
      'Returned temporary wallet funds and removed QA keys.\n',
    );
  } else if (process.env.BAZO_QA_RECOVER_BATCH) {
    lockedBatch = await fetchBatch({
      rpcUrl,
      programAddress: address(programId.toBase58()),
      batchAddress: process.env.BAZO_QA_RECOVER_BATCH,
    });
    if (!lockedBatch || lockedBatch.requests.length !== 3)
      throw new Error('expected locked three-request recovery Batch');
    for (const key of lockedBatch.requests) {
      const request = new anchor.web3.PublicKey(key);
      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('buy-escrow'), request.toBuffer()],
        programId,
      );
      requests.push({ request, escrow });
    }
    await releaseAndRefund();
    await returnTemporarySol();
    process.stdout.write('Recovered expired Batch and refunded all buyers.\n');
  } else if (process.env.BAZO_QA_REQUEST_ONLY === '1') {
    const entry = await createRequest(1_000_000n, 100);
    requests.push(entry);
    process.stdout.write(
      `Funded ingress check request: ${entry.request.toBase58()}\n`,
    );
    await waitForRequestReady(entry);
    coordinator = startCoordinator();
    await waitForCoordinator();
    await expectWrongOpening({
      ...entry.opening,
      maxPremiumBps: 101,
    });
    await deliver('/v1/openings/request', entry.opening);
    const status = await fetch(
      new URL(
        `/v1/openings/request/${entry.request.toBase58()}`,
        coordinatorUrl,
      ),
      {
        headers: { 'x-bazo-coordinator-secret': coordinatorSecret },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!status.ok || (await status.json()).delivered !== true)
      throw new Error('confirmed request opening was not retained');
    coordinator.kill('SIGTERM');
    await waitForExit(coordinator);
    coordinator = undefined;
    await cancelRequest(entry);
    process.stdout.write(
      'Confirmed wrong opening rejection, valid delivery, and refund.\n',
    );
  } else {
    const reusedPlan = process.env.BAZO_QA_REUSE_PLAN;
    if (!reusedPlan) await prepareStock();
    else await fundRecoveryCaller();
    const resumedRequests = process.env.BAZO_QA_RESUME_REQUESTS;
    if (resumedRequests) {
      for (const key of resumedRequests.split(',')) {
        const request = new anchor.web3.PublicKey(key);
        const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from('buy-escrow'), request.toBuffer()],
          programId,
        );
        const opening = parseBuyOpening(
          JSON.parse(
            readFileSync(
              resolve(walletRecoveryDirectory, `request-${key}.json`),
              'utf8',
            ),
          ),
        );
        const entry = { request, escrow, opening };
        requests.push(entry);
        await waitForRequestReady(entry);
      }
    } else {
      for (const [rawQuantity, maxPremiumBps] of [
        [3_000_000n, 150],
        [4_000_000n, 100],
        [5_000_000n, 80],
      ]) {
        const entry = await createRequest(rawQuantity, maxPremiumBps);
        requests.push(entry);
        process.stdout.write(`Funded request: ${entry.request.toBase58()}\n`);
        await waitForRequestReady(entry);
      }
    }
    coordinator = startCoordinator();
    await waitForCoordinator();
    await expectWrongOpening({
      ...requests[0].opening,
      maxPremiumBps: 151,
    });
    for (const entry of requests)
      await deliver('/v1/openings/request', entry.opening);
    const { plan, opening: stageOpening } = reusedPlan
      ? {
          plan: new anchor.web3.PublicKey(reusedPlan),
          opening: parseStageOpening(
            JSON.parse(
              readFileSync(
                resolve(walletRecoveryDirectory, `plan-${reusedPlan}.json`),
                'utf8',
              ),
            ),
          ),
        }
      : await createPlan();
    process.stdout.write(`Funded Plan: ${plan.toBase58()}\n`);
    await deliver('/v1/openings/plan', stageOpening);
    process.stdout.write(
      `Verified private openings delivered for Plan ${plan.toBase58()} and ${requests.length} funded requests.\n`,
    );
    lockedBatch = await waitForLockedBatch();
    const proposal = await waitForProposal(lockedBatch.address);
    const allocations = proposal.allocations.map(entry =>
      BigInt(entry.rawQuantity),
    );
    if (
      proposal.plan !== plan.toBase58() ||
      proposal.marginalPremiumBps !== 80 ||
      allocations.join(',') !== '3000000,4000000,3000000'
    ) {
      throw new Error(
        'the Devnet proposal did not match the expected full-Stage allocation',
      );
    }
    process.stdout.write(
      `Confirmed Batch ${lockedBatch.address} has a 3/4/3 proposal at +80 bps.\n`,
    );
    coordinator.kill('SIGTERM');
    await waitForExit(coordinator);
    coordinator = undefined;
    coordinator = startCoordinator();
    await waitForCoordinator();
    for (const entry of requests)
      await deliver('/v1/openings/request', entry.opening);
    await deliver('/v1/openings/plan', stageOpening);
    const repeatedProposal = await waitForProposal(lockedBatch.address);
    if (JSON.stringify(repeatedProposal) !== JSON.stringify(proposal))
      throw new Error('fresh coordinator produced a different proposal');
    process.stdout.write(
      'Two fresh coordinator runs produced byte-identical proposals.\n',
    );
    coordinator.kill('SIGTERM');
    await waitForExit(coordinator);
    coordinator = undefined;
    coordinator = startCoordinator();
    await waitForCoordinator();
    const retryState = await fetch(
      new URL(
        `/v1/openings/request/${requests[0].request.toBase58()}`,
        coordinatorUrl,
      ),
      {
        headers: { 'x-bazo-coordinator-secret': coordinatorSecret },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!retryState.ok || (await retryState.json()).delivered !== false)
      throw new Error('restart did not request private opening redelivery');
    const publicBatch = await fetchBatch({
      rpcUrl,
      programAddress: address(programId.toBase58()),
      batchAddress: lockedBatch.address,
    });
    if (publicBatch?.status !== 'locked')
      throw new Error('restart lost public lock state');
    coordinator.kill('SIGTERM');
    await waitForExit(coordinator);
    coordinator = undefined;
    process.stdout.write(
      'Coordinator restart retained the public lock and requested private redelivery.\n',
    );
    await releaseAndRefund();
    process.stdout.write(
      'Confirmed non-coordinator expiry release and buyer refunds on Devnet.\n',
    );
    await returnTemporarySol();
    process.stdout.write(
      `Temporary Plan opening retained for recovery: ${walletRecoveryDirectory}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `Devnet Batch QA stopped: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  for (const entry of requests)
    process.stderr.write(
      `Funded request for recovery: ${entry.request.toBase58()}\n`,
    );
  if (lockedBatch)
    process.stderr.write(`Locked Batch for recovery: ${lockedBatch.address}\n`);
  process.stderr.write(
    `Temporary wallet recovery files: ${walletRecoveryDirectory}\n`,
  );
  process.exitCode = 1;
} finally {
  if (coordinator) coordinator.kill('SIGTERM');
}

async function prepareStock() {
  const funding = new anchor.web3.Transaction();
  for (const seller of sellers) {
    if (
      (await provider.connection.getBalance(seller.publicKey, 'confirmed')) <
      10_000_000
    )
      funding.add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: seller.publicKey,
          lamports: 50_000_000,
        }),
      );
  }
  if (funding.instructions.length > 0)
    await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      funding,
      [owner],
      { commitment: 'confirmed' },
    );
  const ownerStock = associatedAddress(owner.publicKey);
  for (const seller of sellers) {
    const sellerStock = associatedAddress(seller.publicKey);
    const createAccount = new anchor.web3.TransactionInstruction({
      programId: associatedTokenProgram,
      keys: [
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: sellerStock, isSigner: false, isWritable: true },
        { pubkey: seller.publicKey, isSigner: false, isWritable: false },
        { pubkey: stockMint, isSigner: false, isWritable: false },
        {
          pubkey: anchor.web3.SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    });
    await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      new anchor.web3.Transaction().add(createAccount),
      [owner],
      { commitment: 'confirmed' },
    );
    const [faucetAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('devnet-stock-faucet'), market.toBuffer()],
      programId,
    );
    const [claim] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from('devnet-stock-claim'),
        market.toBuffer(),
        seller.publicKey.toBuffer(),
      ],
      programId,
    );
    if (!(await provider.connection.getAccountInfo(claim, 'confirmed'))) {
      await program.methods
        .claimDevnetStock()
        .accounts({
          recipient: seller.publicKey,
          market,
          stockMint,
          stockTokenProgram: tokenProgram,
          recipientStockAccount: sellerStock,
          faucetAuthority,
          claim,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([seller])
        .rpc();
    }
    const available = await waitForRawBalance(sellerStock);
    if (available === 0n) continue;
    if (available !== 10_000_000n)
      throw new Error('unexpected temporary stock balance');
    const transferData = Buffer.alloc(10);
    transferData[0] = 12;
    transferData.writeBigUInt64LE(available, 1);
    transferData[9] = 6;
    const transfer = new anchor.web3.TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: sellerStock, isSigner: false, isWritable: true },
        { pubkey: stockMint, isSigner: false, isWritable: false },
        { pubkey: ownerStock, isSigner: false, isWritable: true },
        { pubkey: seller.publicKey, isSigner: true, isWritable: false },
      ],
      data: transferData,
    });
    await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      new anchor.web3.Transaction().add(transfer),
      [owner, seller],
      { commitment: 'confirmed' },
    );
  }
  const balance = await provider.connection.getTokenAccountBalance(
    ownerStock,
    'confirmed',
  );
  if (BigInt(balance.value.amount) < 20_000_000n)
    throw new Error('stock fixture was not funded');
  process.stdout.write(
    'Prepared 20 raw stock units from one-time Devnet claims.\n',
  );
}

async function fundRecoveryCaller() {
  if (
    (await provider.connection.getBalance(sellers[0].publicKey, 'confirmed')) >=
    10_000_000
  )
    return;
  await anchor.web3.sendAndConfirmTransaction(
    provider.connection,
    new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: sellers[0].publicKey,
        lamports: 20_000_000,
      }),
    ),
    [owner],
    { commitment: 'confirmed' },
  );
}

async function waitForRawBalance(account) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await provider.connection.getAccountInfo(account, 'confirmed');
    if (info) {
      const amount = info.data.readBigUInt64LE(64);
      if (amount > 0n || attempt > 4) return amount;
    }
    await pause(1_000);
  }
  throw new Error('temporary stock account was not confirmed');
}

async function createPlan() {
  const nonce = randomPlanNonce();
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64LE(nonce);
  const version = Buffer.from([1, 0]);
  const [plan] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('plan'), version, owner.publicKey.toBuffer(), nonceBytes],
    programId,
  );
  const [stockVault] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('plan-stock-vault'), plan.toBuffer()],
    programId,
  );
  const [proceedsVault] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('plan-proceeds-vault'), plan.toBuffer()],
    programId,
  );
  const stages = [0, 1].map(stageIndex => ({
    schemaVersion: 1,
    network: 1,
    plan: plan.toBase58(),
    market: market.toBase58(),
    stageIndex,
    rawQuantity: 10_000_000n,
    minPremiumBps: stageIndex === 0 ? 50 : 100,
    allowedSessionMask: 15,
    maxReferenceAgeSeconds: 90,
    salt: randomSalt(),
  }));
  const chain = await buildCommitmentChain(stages);
  writeFileSync(
    resolve(walletRecoveryDirectory, `plan-chain-${plan.toBase58()}.json`),
    JSON.stringify(chain.stages.map(serializeOpening)),
    { mode: 0o600 },
  );
  const { commitment: _commitment, ...opening } = chain.stages[0];
  writeFileSync(
    resolve(walletRecoveryDirectory, `plan-${plan.toBase58()}.json`),
    JSON.stringify(serializeOpening(opening)),
    { mode: 0o600 },
  );
  await program.methods
    .createPlan({
      planNonce: new anchor.BN(nonce.toString()),
      currentStageCommitment: [...chain.headCommitment],
      initialRawInventory: new anchor.BN(20_000_000),
      expiresAt: new anchor.BN(Math.floor(Date.now() / 1_000) + 3_600),
      commitmentSchemaVersion: 1,
    })
    .accounts({
      owner: owner.publicKey,
      market,
      stockMint,
      quoteMint,
      stockTokenProgram: tokenProgram,
      quoteTokenProgram,
      ownerStockAccount: associatedAddress(owner.publicKey),
      plan,
      stockVault,
      proceedsVault,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  return { plan, opening };
}

async function createRequest(targetRawQuantity, maxPremiumBps) {
  const nonce = randomPlanNonce();
  const keys = await deriveBuyRequestAddresses({
    programAddress: address(programId.toBase58()),
    buyer: address(owner.publicKey.toBase58()),
    requestNonce: nonce,
  });
  const request = new anchor.web3.PublicKey(keys.request);
  const escrow = new anchor.web3.PublicKey(keys.escrow);
  const expiresAt = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
  const opening = {
    schemaVersion: 1,
    network: 1,
    request: keys.request,
    buyer: address(owner.publicKey.toBase58()),
    recipient: address(owner.publicKey.toBase58()),
    market: address(market.toBase58()),
    targetRawQuantity,
    maxPremiumBps,
    maxQuoteAmount: 10_000_000n,
    expiresAt,
    allowPartialFills: true,
    requestNonce: nonce,
    salt: randomSalt(),
  };
  const commitment = await hashBuyRequestOpening(opening);
  writeFileSync(
    resolve(walletRecoveryDirectory, `request-${request.toBase58()}.json`),
    JSON.stringify(serializeOpening(opening)),
    { mode: 0o600 },
  );
  await program.methods
    .createBuyRequest({
      requestNonce: new anchor.BN(nonce.toString()),
      requestCommitment: [...commitment],
      maxQuoteAmount: new anchor.BN(10_000_000),
      expiresAt: new anchor.BN(expiresAt.toString()),
      recipient: owner.publicKey,
      commitmentSchemaVersion: 1,
    })
    .accounts({
      buyer: owner.publicKey,
      market,
      stockMint,
      quoteMint,
      stockTokenProgram: tokenProgram,
      quoteTokenProgram,
      buyerQuoteAccount: buyerQuote,
      recipientStockAccount: buyerStock,
      request,
      escrow,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  return { request, escrow, opening };
}

async function waitForRequestReady(entry) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const request = await fetchBuyRequest({
        rpcUrl,
        programAddress: address(programId.toBase58()),
        requestAddress: entry.request.toBase58(),
      });
      const escrow = await provider.connection.getTokenAccountBalance(
        entry.escrow,
        'confirmed',
      );
      const commitment = Buffer.from(
        await hashBuyRequestOpening(entry.opening),
      ).toString('hex');
      if (
        request?.status === 'active' &&
        request.commitmentHex === commitment &&
        BigInt(escrow.value.amount) === 10_000_000n
      )
        return;
    } catch {
      /* Wait for confirmed account and escrow reads. */
    }
    await pause(1_000);
  }
  throw new Error('funded request did not reach a confirmed, matching state');
}

function startCoordinator() {
  const child = spawn(
    process.execPath,
    ['--env-file=../../.env', '--import', 'tsx', 'src/index.ts'],
    {
      cwd: resolve(root, 'services/coordinator'),
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  child.stderr.on('data', () => undefined);
  return child;
}

async function waitForCoordinator() {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (coordinator.exitCode !== null)
      throw new Error('coordinator exited during startup');
    try {
      const response = await fetch(
        new URL('/v1/batches/11111111111111111111111111111111', coordinatorUrl),
        { signal: AbortSignal.timeout(1_000) },
      );
      if (response.status === 401) return;
    } catch {
      /* Retry while the coordinator verifies chain state. */
    }
    await pause(1_000);
  }
  throw new Error('coordinator did not start');
}

async function deliver(path, opening) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await postOpening(path, opening);
      if (response.ok) return;
      const result = await response
        .json()
        .catch(() => ({ code: 'unavailable' }));
      const code =
        typeof result?.code === 'string' ? result.code : 'unavailable';
      if (code !== 'unavailable')
        throw new Error(
          `private opening delivery failed with HTTP ${response.status} (${code})`,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('private opening delivery failed')
      )
        throw error;
    }
    await pause(2_000);
  }
  throw new Error(`private opening delivery remained unavailable for ${path}`);
}

async function expectWrongOpening(opening) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await postOpening('/v1/openings/request', opening);
      const result = await response.json();
      if (
        response.status === 400 &&
        result.code === 'request_commitment_mismatch'
      )
        return;
      if (result.code !== 'unavailable')
        throw new Error('mismatched request opening was accepted');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'mismatched request opening was accepted'
      )
        throw error;
    }
    await pause(2_000);
  }
  throw new Error('wrong-opening rejection could not be confirmed');
}

async function postOpening(path, opening) {
  return fetch(new URL(path, coordinatorUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bazo-coordinator-secret': coordinatorSecret,
    },
    body: JSON.stringify(serializeOpening(opening)),
    signal: AbortSignal.timeout(10_000),
  });
}

async function waitForLockedBatch() {
  const start = batchWindowStart(BigInt(Math.floor(Date.now() / 1_000)), 45n);
  const starts = [start - 45n, start, start + 45n, start + 90n];
  for (let attempt = 0; attempt < 42; attempt++) {
    for (const windowStart of starts) {
      const batchAddress = await deriveBatchAddress(
        address(programId.toBase58()),
        address(market.toBase58()),
        windowStart,
      );
      const batch = await fetchBatch({
        rpcUrl,
        programAddress: address(programId.toBase58()),
        batchAddress,
      });
      if (
        batch?.status === 'locked' &&
        batch.requests.length === 3 &&
        requests.every(entry =>
          batch.requests.includes(entry.request.toBase58()),
        )
      )
        return batch;
    }
    await pause(5_000);
  }
  throw new Error('eligible requests did not lock in a Devnet Batch');
}

async function waitForProposal(batchAddress) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(
        new URL(`/v1/proposals/${batchAddress}`, coordinatorUrl),
        {
          headers: { 'x-bazo-coordinator-secret': coordinatorSecret },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (response.ok) {
        const result = await response.json();
        if (result.proposal) return result.proposal;
      }
    } catch {
      // Retry transient public RPC delays until the lock expires.
    }
    await pause(2_000);
  }
  throw new Error('full-Stage proposal was not produced');
}

async function releaseAndRefund() {
  const deadline = Number(lockedBatch.lockDeadline);
  while (Math.floor(Date.now() / 1_000) <= deadline + 2) await pause(1_000);
  await program.methods
    .expireBatch()
    .accounts({
      caller: sellers[0].publicKey,
      batch: new anchor.web3.PublicKey(lockedBatch.address),
    })
    .remainingAccounts(
      lockedBatch.requests.map(key => ({
        pubkey: new anchor.web3.PublicKey(key),
        isSigner: false,
        isWritable: true,
      })),
    )
    .signers([sellers[0]])
    .rpc();
  for (let attempt = 0; attempt < 20; attempt++) {
    const ended = await fetchBatch({
      rpcUrl,
      programAddress: address(programId.toBase58()),
      batchAddress: lockedBatch.address,
    });
    if (ended?.status === 'expired') break;
    if (attempt === 19) throw new Error('Batch expiry was not confirmed');
    await pause(1_000);
  }
  for (const entry of requests) {
    await cancelRequest(entry);
  }
}

async function cancelRequest(entry) {
  await program.methods
    .cancelBuyRequest()
    .accounts({
      buyer: owner.publicKey,
      request: entry.request,
      market,
      quoteMint,
      quoteTokenProgram,
      escrow: entry.escrow,
      buyerQuoteDestination: buyerQuote,
    })
    .rpc();
  for (let attempt = 0; attempt < 20; attempt++) {
    const request = await fetchBuyRequest({
      rpcUrl,
      programAddress: address(programId.toBase58()),
      requestAddress: entry.request.toBase58(),
    });
    if (request?.status === 'canceled') return;
    if (attempt === 19) throw new Error('buyer refund was not confirmed');
    await pause(1_000);
  }
}

async function returnTemporarySol() {
  for (const seller of sellers) {
    const lamports = await provider.connection.getBalance(
      seller.publicKey,
      'confirmed',
    );
    if (lamports === 0) continue;
    const transfer = anchor.web3.SystemProgram.transfer({
      fromPubkey: seller.publicKey,
      toPubkey: owner.publicKey,
      lamports,
    });
    await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      new anchor.web3.Transaction().add(transfer),
      [owner, seller],
      { commitment: 'confirmed' },
    );
  }
}

function associatedAddress(
  wallet,
  mint = stockMint,
  mintProgram = tokenProgram,
) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), mintProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram,
  )[0];
}
function waitForExit(child) {
  return child.exitCode !== null
    ? Promise.resolve()
    : new Promise(resolveExit => child.once('exit', resolveExit));
}
function pause(ms) {
  return new Promise(resolvePause => setTimeout(resolvePause, ms));
}
function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
}
