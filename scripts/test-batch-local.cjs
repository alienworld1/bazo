#!/usr/bin/env node

const anchor = require('@anchor-lang/core');
const idl = require('../target/idl/bazo.json');

const rpcUrl = 'http://127.0.0.1:8899';
const stockMint = new anchor.web3.PublicKey(required('BAZO_LOCAL_STOCK_MINT'));
const quoteMint = new anchor.web3.PublicKey(required('BAZO_LOCAL_QUOTE_MINT'));
const stockAccount = new anchor.web3.PublicKey(
  required('BAZO_LOCAL_STOCK_ACCOUNT'),
);
const quoteAccount = new anchor.web3.PublicKey(
  required('BAZO_LOCAL_QUOTE_ACCOUNT'),
);
const tokenProgram = new anchor.web3.PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);
const provider = anchor.AnchorProvider.local(rpcUrl);
const program = new anchor.Program(idl, provider);
const version = Buffer.from([1, 0]);

async function main() {
  const [protocolConfig] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('protocol')],
    program.programId,
  );
  const [market] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('market'), stockMint.toBuffer(), quoteMint.toBuffer()],
    program.programId,
  );
  const [policy] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('batch-policy'), market.toBuffer()],
    program.programId,
  );
  if (!(await provider.connection.getAccountInfo(protocolConfig)))
    await confirmed(program.methods.initializeProtocol());
  if (!(await provider.connection.getAccountInfo(market)))
    await confirmed(
      program.methods
        .createMarket({
          pythFeedId: new anchor.BN(1435),
          allowedSessionMask: 1,
          maxReferenceAgeSeconds: 90,
          minimumStageRawAmount: new anchor.BN(1),
          supportedStockExtensions: 1,
        })
        .accountsPartial({
          authority: provider.wallet.publicKey,
          protocolConfig,
          stockMint,
          quoteMint,
          stockTokenProgram: tokenProgram,
          quoteTokenProgram: tokenProgram,
          market,
        }),
    );
  if (!(await provider.connection.getAccountInfo(policy)))
    await confirmed(
      program.methods
        .initializeBatchPolicy(new anchor.BN(45), new anchor.BN(120))
        .accountsPartial({
          authority: provider.wallet.publicKey,
          market,
          policy,
        }),
    );

  let now = await chainTime();
  while (45 - (now % 45) < 22) {
    await pause(1000);
    now = await chainTime();
  }
  const start = Math.floor(now / 45) * 45;
  const end = start + 45;
  const [batch] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('batch'), version, market.toBuffer(), i64(start)],
    program.programId,
  );
  await confirmed(
    program.methods
      .openBatch(new anchor.BN(start))
      .accountsPartial({
        caller: provider.wallet.publicKey,
        market,
        policy,
        batch,
      }),
  );
  await expectFailure(
    program.methods
      .openBatch(new anchor.BN(start))
      .accountsPartial({
        caller: provider.wallet.publicKey,
        market,
        policy,
        batch,
      }),
    'duplicate open',
  );

  const requests = [];
  for (let index = 0; index < 4; index++) {
    const nonce = BigInt(Date.now()) * 10n + BigInt(index);
    const [request] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from('buy-request'),
        version,
        provider.wallet.publicKey.toBuffer(),
        u64(nonce),
      ],
      program.programId,
    );
    const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('buy-escrow'), request.toBuffer()],
      program.programId,
    );
    await confirmed(
      program.methods
        .createBuyRequest({
          requestNonce: new anchor.BN(nonce.toString()),
          requestCommitment: Array(32).fill(index + 1),
          maxQuoteAmount: new anchor.BN(10_000_000),
          expiresAt: new anchor.BN(end + 600),
          recipient: provider.wallet.publicKey,
          commitmentSchemaVersion: 1,
        })
        .accountsPartial({
          buyer: provider.wallet.publicKey,
          market,
          stockMint,
          quoteMint,
          stockTokenProgram: tokenProgram,
          quoteTokenProgram: tokenProgram,
          buyerQuoteAccount: quoteAccount,
          recipientStockAccount: stockAccount,
          request,
          escrow,
        }),
    );
    requests.push({ request, escrow });
  }
  requests.sort((a, b) =>
    Buffer.compare(a.request.toBuffer(), b.request.toBuffer()),
  );
  const remaining = requests.flatMap(entry => [
    { pubkey: entry.request, isWritable: true, isSigner: false },
    { pubkey: entry.escrow, isWritable: false, isSigner: false },
  ]);
  const keys = requests.map(entry => entry.request);
  const operation = selected =>
    program.methods
      .lockBatch(selected)
      .accountsPartial({ caller: provider.wallet.publicKey, market, batch })
      .remainingAccounts(remaining);
  await expectFailure(operation(keys), 'lock before window boundary');
  await waitFor(end);
  await expectFailure(
    operation([keys[1], keys[0], ...keys.slice(2)]),
    'out-of-order set',
  );
  await expectFailure(operation([...keys, keys[3]]), 'oversized set');
  const lockSimulation = await provider.simulate(
    await operation(keys).transaction(),
  );
  process.stdout.write(
    `Four-request lock simulation used ${lockSimulation.unitsConsumed ?? 'unknown'} compute units.\n`,
  );
  const lockSignature = await confirmed(operation(keys));
  const locked = await program.account.batch.fetch(batch);
  if (
    locked.status !== 2 ||
    locked.requests.length !== 4 ||
    !locked.requests.every((key, index) => key.equals(keys[index]))
  )
    throw new Error('locked set mismatch');
  const tx = await provider.connection.getTransaction(lockSignature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (tx?.meta?.computeUnitsConsumed)
    process.stdout.write(
      `Confirmed lock used ${tx.meta.computeUnitsConsumed} compute units.\n`,
    );
  if (process.argv.includes('--measure-only')) return;
  await expectFailure(operation(keys), 'duplicate lock');
  await expectFailure(
    program.methods
      .cancelBuyRequest()
      .accountsPartial({
        buyer: provider.wallet.publicKey,
        request: keys[0],
        market,
        quoteMint,
        quoteTokenProgram: tokenProgram,
        escrow: requests[0].escrow,
        buyerQuoteDestination: quoteAccount,
      }),
    'cancel during live lock',
  );
  await expectFailure(
    program.methods
      .expireBatch()
      .accountsPartial({ caller: provider.wallet.publicKey, batch })
      .remainingAccounts(
        requests.map(entry => ({
          pubkey: entry.request,
          isWritable: true,
          isSigner: false,
        })),
      ),
    'early expiry',
  );
  await waitFor(end + 120);
  await confirmed(
    program.methods
      .expireBatch()
      .accountsPartial({ caller: provider.wallet.publicKey, batch })
      .remainingAccounts(
        requests.map(entry => ({
          pubkey: entry.request,
          isWritable: true,
          isSigner: false,
        })),
      ),
  );
  const expired = await program.account.batch.fetch(batch);
  if (expired.status !== 3) throw new Error('expiry not confirmed');
  await confirmed(
    program.methods
      .cancelBuyRequest()
      .accountsPartial({
        buyer: provider.wallet.publicKey,
        request: keys[0],
        market,
        quoteMint,
        quoteTokenProgram: tokenProgram,
        escrow: requests[0].escrow,
        buyerQuoteDestination: quoteAccount,
      }),
  );
  process.stdout.write(
    'Confirmed open, bounded lock, cancellation guard, expiry release, and recovery on the local validator.\n',
  );
}

async function chainTime() {
  const account = await provider.connection.getAccountInfo(
    anchor.web3.SYSVAR_CLOCK_PUBKEY,
    'confirmed',
  );
  if (!account) throw new Error('chain clock unavailable');
  return Number(account.data.readBigInt64LE(32));
}
async function waitFor(target) {
  while ((await chainTime()) < target) await pause(1000);
}
function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}
function i64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
}
async function confirmed(operation) {
  await operation.simulate();
  const signature = await operation.rpc();
  const status = await provider.connection.getSignatureStatus(signature);
  if (status.value?.err) throw new Error('transaction failed');
  return signature;
}
async function expectFailure(operation, label) {
  try {
    await operation.simulate();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}
function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

main().catch(error => {
  process.stderr.write(
    `${error.stack ?? String(error)}\n${JSON.stringify(error.simulationResponse ?? {})}\n`,
  );
  process.exitCode = 1;
});
