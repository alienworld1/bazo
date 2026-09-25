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
  const owner = provider.wallet.publicKey;
  const [protocolConfig] = pda('protocol');
  const [market] = pda('market', stockMint.toBuffer(), quoteMint.toBuffer());
  if (!(await provider.connection.getAccountInfo(protocolConfig)))
    await confirmed(program.methods.initializeProtocol());
  if (!(await provider.connection.getAccountInfo(market))) {
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
          authority: owner,
          protocolConfig,
          stockMint,
          quoteMint,
          stockTokenProgram: tokenProgram,
          quoteTokenProgram: tokenProgram,
          market,
        }),
    );
  }

  const nonce = BigInt(Date.now());
  const [plan] = pda('plan', version, owner.toBuffer(), u64(nonce));
  const [stockVault] = pda('plan-stock-vault', plan.toBuffer());
  const [proceedsVault] = pda('plan-proceeds-vault', plan.toBuffer());
  const [reservation] = pda(
    'plan-reservation',
    plan.toBuffer(),
    Buffer.alloc(2),
  );
  const stockBefore = await tokenAmount(stockAccount);
  await confirmed(
    program.methods
      .createPlan({
        planNonce: new anchor.BN(nonce.toString()),
        currentStageCommitment: Array(32).fill(7),
        initialRawInventory: new anchor.BN(10_000_000),
        expiresAt: new anchor.BN((await chainTime()) + 600),
        commitmentSchemaVersion: 1,
      })
      .accountsPartial({
        owner,
        market,
        stockMint,
        quoteMint,
        stockTokenProgram: tokenProgram,
        quoteTokenProgram: tokenProgram,
        ownerStockAccount: stockAccount,
        plan,
        stockVault,
        proceedsVault,
      }),
  );
  if ((await tokenAmount(stockVault)) !== 10_000_000n)
    throw new Error('Plan funding mismatch');

  const cancel = () =>
    program.methods
      .cancelPlan()
      .accountsPartial({ owner, plan, market, reservation });
  await expectFailure(
    program.methods
      .cancelPlan()
      .accountsPartial({ owner, plan, market, reservation: stockVault }),
    'wrong reservation',
  );
  await confirmed(cancel());
  const canceled = await program.account.plan.fetch(plan);
  if (
    canceled.status !== 2 ||
    !canceled.remainingRawInventory.eq(new anchor.BN(10_000_000)) ||
    !canceled.soldRawInventory.isZero() ||
    !canceled.quoteProceedsAccrued.isZero()
  )
    throw new Error('Plan cancellation changed accounting');
  await expectFailure(cancel(), 'duplicate cancellation');
  const withdraw = () =>
    program.methods.withdrawRemainingStock().accountsPartial({
      owner,
      plan,
      market,
      stockMint,
      stockTokenProgram: tokenProgram,
      stockVault,
      ownerStockDestination: stockAccount,
      reservation,
    });
  await confirmed(withdraw());
  if (
    (await tokenAmount(stockVault)) !== 0n ||
    (await tokenAmount(stockAccount)) !== stockBefore
  )
    throw new Error('Stock return did not conserve raw units');
  await expectFailure(withdraw(), 'duplicate stock return');

  const requestNonce = nonce + 1n;
  const [request] = pda(
    'buy-request',
    version,
    owner.toBuffer(),
    u64(requestNonce),
  );
  const [escrow] = pda('buy-escrow', request.toBuffer());
  const quoteBefore = await tokenAmount(quoteAccount);
  await confirmed(
    program.methods
      .createBuyRequest({
        requestNonce: new anchor.BN(requestNonce.toString()),
        requestCommitment: Array(32).fill(9),
        maxQuoteAmount: new anchor.BN(7_000_000),
        expiresAt: new anchor.BN((await chainTime()) + 600),
        recipient: owner,
        commitmentSchemaVersion: 1,
      })
      .accountsPartial({
        buyer: owner,
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
  await expectFailure(
    program.methods.cancelBuyRequest().accountsPartial({
      buyer: owner,
      request,
      market,
      quoteMint,
      quoteTokenProgram: tokenProgram,
      escrow: stockVault,
      buyerQuoteDestination: quoteAccount,
    }),
    'wrong escrow',
  );
  const cancelRequest = () =>
    program.methods.cancelBuyRequest().accountsPartial({
      buyer: owner,
      request,
      market,
      quoteMint,
      quoteTokenProgram: tokenProgram,
      escrow,
      buyerQuoteDestination: quoteAccount,
    });
  await confirmed(cancelRequest());
  if (
    (await tokenAmount(escrow)) !== 0n ||
    (await tokenAmount(quoteAccount)) !== quoteBefore
  )
    throw new Error('Quote cancellation did not conserve raw units');
  await expectFailure(cancelRequest(), 'duplicate request cancellation');
  await checkReservationRecovery({ owner, market, nonce: nonce + 2n });
  process.stdout.write(
    'Confirmed owner exits, lock guards, permissionless timeout release, conservation, account substitution rejection, and duplicate rejection on the local validator.\n',
  );
}

async function checkReservationRecovery({ owner, market, nonce }) {
  const [batchPolicy] = pda('batch-policy', market.toBuffer());
  const [settlementPolicy] = pda('settlement-policy', market.toBuffer());
  if (!(await provider.connection.getAccountInfo(batchPolicy)))
    await confirmed(
      program.methods
        .initializeBatchPolicy(new anchor.BN(30), new anchor.BN(60))
        .accountsPartial({ authority: owner, market, policy: batchPolicy }),
    );
  if (!(await provider.connection.getAccountInfo(settlementPolicy)))
    await confirmed(
      program.methods
        .initializeSettlementPolicy(1, 1_000, owner)
        .accountsPartial({
          authority: owner,
          market,
          policy: settlementPolicy,
        }),
    );

  let now = await chainTime();
  if (30 - (now % 30) < 15) {
    await waitFor(Math.floor(now / 30) * 30 + 30);
    now = await chainTime();
  }
  const windowStart = Math.floor(now / 30) * 30;
  const windowEnd = windowStart + 30;
  const lockDeadline = windowEnd + 60;
  const [batch] = pda('batch', version, market.toBuffer(), i64(windowStart));
  await confirmed(
    program.methods
      .openBatch(new anchor.BN(windowStart))
      .accountsPartial({ caller: owner, market, policy: batchPolicy, batch }),
  );

  const [plan] = pda('plan', version, owner.toBuffer(), u64(nonce));
  const [stockVault] = pda('plan-stock-vault', plan.toBuffer());
  const [proceedsVault] = pda('plan-proceeds-vault', plan.toBuffer());
  const [reservation] = pda(
    'plan-reservation',
    plan.toBuffer(),
    Buffer.alloc(2),
  );
  await confirmed(
    program.methods
      .createPlan({
        planNonce: new anchor.BN(nonce.toString()),
        currentStageCommitment: Array(32).fill(11),
        initialRawInventory: new anchor.BN(5_000_000),
        expiresAt: new anchor.BN(windowEnd + 20),
        commitmentSchemaVersion: 1,
      })
      .accountsPartial({
        owner,
        market,
        stockMint,
        quoteMint,
        stockTokenProgram: tokenProgram,
        quoteTokenProgram: tokenProgram,
        ownerStockAccount: stockAccount,
        plan,
        stockVault,
        proceedsVault,
      }),
  );

  const requestNonce = nonce + 1n;
  const [request] = pda(
    'buy-request',
    version,
    owner.toBuffer(),
    u64(requestNonce),
  );
  const [escrow] = pda('buy-escrow', request.toBuffer());
  await confirmed(
    program.methods
      .createBuyRequest({
        requestNonce: new anchor.BN(requestNonce.toString()),
        requestCommitment: Array(32).fill(12),
        maxQuoteAmount: new anchor.BN(3_000_000),
        expiresAt: new anchor.BN(lockDeadline + 120),
        recipient: owner,
        commitmentSchemaVersion: 1,
      })
      .accountsPartial({
        buyer: owner,
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

  await waitFor(windowEnd);
  await confirmed(
    program.methods
      .lockBatch([request])
      .accountsPartial({ caller: owner, market, batch })
      .remainingAccounts([
        { pubkey: request, isWritable: true, isSigner: false },
        { pubkey: escrow, isWritable: false, isSigner: false },
      ]),
  );
  await confirmed(
    program.methods
      .reservePlan()
      .accountsPartial({
        caller: owner,
        market,
        policy: settlementPolicy,
        plan,
        batch,
        reservation,
      }),
  );
  await expectFailure(
    program.methods
      .cancelPlan()
      .accountsPartial({ owner, plan, market, reservation }),
    'cancel during live reservation',
  );
  await expectFailure(
    program.methods
      .cancelBuyRequest()
      .accountsPartial({
        buyer: owner,
        request,
        market,
        quoteMint,
        quoteTokenProgram: tokenProgram,
        escrow,
        buyerQuoteDestination: quoteAccount,
      }),
    'cancel during live Batch lock',
  );
  await waitFor(windowEnd + 20);
  await expectFailure(
    program.methods
      .withdrawRemainingStock()
      .accountsPartial({
        owner,
        plan,
        market,
        stockMint,
        stockTokenProgram: tokenProgram,
        stockVault,
        ownerStockDestination: stockAccount,
        reservation,
      }),
    'stock return during live reservation',
  );

  await waitFor(lockDeadline);
  const outsider = anchor.web3.Keypair.generate();
  await confirmed(
    program.methods
      .expireBatch()
      .accountsPartial({ caller: outsider.publicKey, batch })
      .remainingAccounts([
        { pubkey: request, isWritable: true, isSigner: false },
      ])
      .signers([outsider]),
    false,
  );
  await confirmed(
    program.methods
      .releasePlanReservation()
      .accountsPartial({ caller: outsider.publicKey, plan, reservation })
      .signers([outsider]),
    false,
  );
  await confirmed(
    program.methods
      .withdrawRemainingStock()
      .accountsPartial({
        owner,
        plan,
        market,
        stockMint,
        stockTokenProgram: tokenProgram,
        stockVault,
        ownerStockDestination: stockAccount,
        reservation,
      }),
  );
  await confirmed(
    program.methods
      .cancelBuyRequest()
      .accountsPartial({
        buyer: owner,
        request,
        market,
        quoteMint,
        quoteTokenProgram: tokenProgram,
        escrow,
        buyerQuoteDestination: quoteAccount,
      }),
  );
  if (
    (await tokenAmount(stockVault)) !== 0n ||
    (await tokenAmount(escrow)) !== 0n
  )
    throw new Error('timeout exit failed to clear custody');
}

function pda(seed, ...extra) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...extra],
    program.programId,
  );
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
async function waitFor(unix) {
  while ((await chainTime()) < unix)
    await new Promise(resolve => setTimeout(resolve, 1_000));
}
async function chainTime() {
  const info = await provider.connection.getAccountInfo(
    anchor.web3.SYSVAR_CLOCK_PUBKEY,
    'confirmed',
  );
  return Number(info.data.readBigInt64LE(32));
}
async function tokenAmount(key) {
  return BigInt(
    (await provider.connection.getTokenAccountBalance(key, 'confirmed')).value
      .amount,
  );
}
async function confirmed(operation, simulate = true) {
  if (simulate) await operation.simulate();
  const signature = await operation.rpc();
  await provider.connection.confirmTransaction(signature, 'confirmed');
  const result = await provider.connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });
  if (result.value?.err || !result.value)
    throw new Error('transaction did not confirm');
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
