#!/usr/bin/env node

const anchor = require('@anchor-lang/core');
const { readFileSync } = require('node:fs');
const idl = require('../target/idl/bazo.json');

const DEVNET_RPC_URL = required('SOLANA_RPC_URL');
const STOCK_MINT = new anchor.web3.PublicKey(required('BAZO_STOCK_MINT'));
const QUOTE_MINT = new anchor.web3.PublicKey(required('BAZO_QUOTE_MINT'));
const STOCK_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  required('BAZO_STOCK_TOKEN_PROGRAM'),
);
const QUOTE_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  required('BAZO_QUOTE_TOKEN_PROGRAM'),
);

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  if (required('SOLANA_NETWORK') !== 'devnet')
    throw new Error('Setup is restricted to Devnet');
  process.env.ANCHOR_WALLET ??= required('BAZO_COORDINATOR_FEE_PAYER_PATH');
  const provider = anchor.AnchorProvider.local(DEVNET_RPC_URL);
  const program = new anchor.Program(idl, provider);
  if (program.programId.toBase58() !== required('BAZO_PROGRAM_ID'))
    throw new Error('Built program ID differs from configured deployment');
  const baseAccounts = {
    authority: provider.wallet.publicKey,
    stockMint: STOCK_MINT,
    quoteMint: QUOTE_MINT,
    stockTokenProgram: STOCK_TOKEN_PROGRAM_ID,
    quoteTokenProgram: QUOTE_TOKEN_PROGRAM_ID,
  };
  const feedId = new anchor.BN(required('BAZO_PYTH_FEED_ID'));
  const allowedSessionMask = required('BAZO_ALLOWED_SESSIONS')
    .split(',')
    .reduce((mask, session) => {
      const bit = { regular: 1, preMarket: 2, postMarket: 4, overNight: 8 }[
        session
      ];
      if (!bit) throw new Error('Invalid allowed session');
      return mask | bit;
    }, 0);
  const maximumAgeSeconds = Number(required('BAZO_MAX_REFERENCE_AGE_SECONDS'));
  const minimumStageRawAmount = new anchor.BN(
    required('BAZO_MINIMUM_STAGE_RAW_AMOUNT'),
  );
  if (!Number.isInteger(maximumAgeSeconds) || maximumAgeSeconds < 1)
    throw new Error('Invalid maximum reference age');
  const marketArgs = {
    pythFeedId: feedId,
    allowedSessionMask,
    maxReferenceAgeSeconds: maximumAgeSeconds,
    minimumStageRawAmount,
    supportedStockExtensions: 1,
  };
  const protocolAccounts = await program.methods.initializeProtocol().pubkeys();
  const marketBaseAccounts = {
    ...baseAccounts,
    protocolConfig: protocolAccounts.protocolConfig,
  };
  const marketAccounts = await program.methods
    .createMarket(marketArgs)
    .accountsPartial(marketBaseAccounts)
    .pubkeys();

  if (
    !(await provider.connection.getAccountInfo(protocolAccounts.protocolConfig))
  ) {
    if (checkOnly) process.stdout.write('Protocol needs initialization.\n');
    else {
      const signature = await program.methods.initializeProtocol().rpc();
      process.stdout.write(`Protocol initialized: ${signature}\n`);
    }
  } else {
    process.stdout.write('Protocol configuration already exists.\n');
  }

  if (!(await provider.connection.getAccountInfo(marketAccounts.market))) {
    if (checkOnly) process.stdout.write('Market needs creation.\n');
    else {
      const signature = await program.methods
        .createMarket(marketArgs)
        .accountsPartial(marketBaseAccounts)
        .rpc();
      process.stdout.write(`Market created: ${signature}\n`);
    }
  } else {
    const state = await program.account.market.fetch(marketAccounts.market);
    if (
      !state.pythFeedId.eq(feedId) ||
      state.allowedSessionMask !== allowedSessionMask ||
      state.maxReferenceAgeSeconds !== maximumAgeSeconds ||
      !state.minimumStageRawAmount.eq(minimumStageRawAmount) ||
      !state.stockMint.equals(STOCK_MINT) ||
      !state.quoteMint.equals(QUOTE_MINT) ||
      !state.stockTokenProgram.equals(STOCK_TOKEN_PROGRAM_ID) ||
      !state.quoteTokenProgram.equals(QUOTE_TOKEN_PROGRAM_ID) ||
      !state.enabled
    )
      throw new Error('Existing Market differs from requested configuration');
    process.stdout.write('Market already exists.\n');
    if (checkOnly) {
      process.stdout.write(`Market authority: ${state.authority.toBase58()}\n`);
      process.stdout.write(`Check wallet matches authority: ${state.authority.equals(provider.wallet.publicKey)}\n`);
    } else if (!state.authority.equals(provider.wallet.publicKey)) {
      throw new Error('ANCHOR_WALLET does not own the configured Market');
    }
  }

  const windowSeconds = Number(process.env.BAZO_BATCH_DURATION_SECONDS ?? '45');
  const lockSeconds = Number(process.env.BAZO_BATCH_LOCK_SECONDS ?? '120');
  if (
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds < 30 ||
    windowSeconds > 60 ||
    !Number.isSafeInteger(lockSeconds) ||
    lockSeconds < 60 ||
    lockSeconds > 300
  )
    throw new Error('Invalid Batch policy');
  const [policy] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('batch-policy'), marketAccounts.market.toBuffer()],
    program.programId,
  );
  const existingPolicy = await provider.connection.getAccountInfo(
    policy,
    'confirmed',
  );
  if (!existingPolicy) {
    if (checkOnly) process.stdout.write('Batch policy needs initialization.\n');
    else {
      const operation = program.methods
        .initializeBatchPolicy(
          new anchor.BN(windowSeconds),
          new anchor.BN(lockSeconds),
        )
        .accountsPartial({
          authority: provider.wallet.publicKey,
          market: marketAccounts.market,
          policy,
        });
      await operation.simulate();
      const signature = await operation.rpc();
      process.stdout.write(`Batch policy created: ${signature}\n`);
    }
  } else {
    const policyState = await program.account.batchPolicy.fetch(policy);
    if (
      Number(policyState.windowSeconds) !== windowSeconds ||
      Number(policyState.lockSeconds) !== lockSeconds
    )
      throw new Error(
        'Existing Batch policy differs from requested configuration',
      );
    process.stdout.write('Batch policy already exists.\n');
  }

  const minimumPublisherCount = Number(process.env.BAZO_MIN_PUBLISHER_COUNT);
  const maximumConfidenceRatioBps = Number(
    process.env.BAZO_MAX_CONFIDENCE_RATIO_BPS,
  );
  const coordinatorPath = process.env.BAZO_COORDINATOR_FEE_PAYER_PATH;
  if (
    !Number.isInteger(minimumPublisherCount) ||
    minimumPublisherCount < 1 ||
    !Number.isInteger(maximumConfidenceRatioBps) ||
    maximumConfidenceRatioBps < 1 ||
    maximumConfidenceRatioBps > 10_000 ||
    !coordinatorPath
  )
    throw new Error('Invalid settlement policy configuration');
  const coordinatorBytes = JSON.parse(readFileSync(coordinatorPath, 'utf8'));
  if (
    !Array.isArray(coordinatorBytes) ||
    coordinatorBytes.length !== 64 ||
    coordinatorBytes.some(
      value => !Number.isInteger(value) || value < 0 || value > 255,
    )
  )
    throw new Error('Invalid coordinator fee payer');
  const reservationAuthority = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(coordinatorBytes),
  ).publicKey;
  const [settlementPolicy] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('settlement-policy'), marketAccounts.market.toBuffer()],
    program.programId,
  );
  const existingSettlementPolicy = await provider.connection.getAccountInfo(
    settlementPolicy,
    'confirmed',
  );
  if (!existingSettlementPolicy) {
    if (checkOnly)
      process.stdout.write('Settlement policy needs initialization.\n');
    else {
      const operation = program.methods
        .initializeSettlementPolicy(
          minimumPublisherCount,
          maximumConfidenceRatioBps,
          reservationAuthority,
        )
        .accountsPartial({
          authority: provider.wallet.publicKey,
          market: marketAccounts.market,
          policy: settlementPolicy,
        });
      await operation.simulate();
      const signature = await operation.rpc();
      process.stdout.write(`Settlement policy created: ${signature}\n`);
    }
  } else {
    const state =
      await program.account.settlementPolicy.fetch(settlementPolicy);
    if (
      state.minimumPublisherCount !== minimumPublisherCount ||
      state.maximumConfidenceRatioBps !== maximumConfidenceRatioBps ||
      !state.reservationAuthority.equals(reservationAuthority)
    )
      throw new Error(
        'Existing settlement policy differs from requested configuration',
      );
    process.stdout.write('Settlement policy already exists.\n');
  }

  process.stdout.write(
    `Protocol config: ${protocolAccounts.protocolConfig.toBase58()}\n`,
  );
  process.stdout.write(`Market: ${marketAccounts.market.toBase58()}\n`);
  process.stdout.write(`Batch policy: ${policy.toBase58()}\n`);
  process.stdout.write(`Settlement policy: ${settlementPolicy.toBase58()}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
