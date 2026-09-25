#!/usr/bin/env node

const anchor = require('@anchor-lang/core');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const idl = require('../target/idl/bazo.json');
const UPGRADEABLE_LOADER = new anchor.web3.PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

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
  const deployedProgram = await provider.connection.getAccountInfo(
    program.programId,
    'confirmed',
  );
  if (
    !deployedProgram?.executable ||
    !deployedProgram.owner.equals(UPGRADEABLE_LOADER)
  )
    throw new Error('Configured program is not a deployed upgradeable program');
  if (
    deployedProgram.data.length !== 36 ||
    deployedProgram.data.readUInt32LE(0) !== 2
  )
    throw new Error(
      'Deployed program has an invalid upgradeable loader account',
    );
  const programDataAddress = new anchor.web3.PublicKey(
    deployedProgram.data.subarray(4, 36),
  );
  const programData = await provider.connection.getAccountInfo(
    programDataAddress,
    'confirmed',
  );
  if (
    !programData?.owner.equals(UPGRADEABLE_LOADER) ||
    programData.data.length < 45 ||
    programData.data.readUInt32LE(0) !== 3 ||
    ![0, 1].includes(programData.data[12])
  )
    throw new Error('Program data or upgrade authority could not be verified');
  const upgradeAuthority =
    programData.data[12] === 1
      ? new anchor.web3.PublicKey(programData.data.subarray(13, 45)).toBase58()
      : 'none';
  const binaryPath = resolve(__dirname, '../target/deploy/bazo.so');
  if (!existsSync(binaryPath))
    throw new Error('Build the program before checking deployment');
  const localBinary = readFileSync(binaryPath);
  const deployedBinary = programData.data.subarray(45);
  if (
    deployedBinary.length < localBinary.length ||
    !deployedBinary.subarray(0, localBinary.length).equals(localBinary) ||
    deployedBinary.subarray(localBinary.length).some(byte => byte !== 0)
  )
    throw new Error(
      'Deployed program bytes differ from the local build; deploy and verify before setup',
    );
  for (const [label, mint, tokenProgram] of [
    ['stock', STOCK_MINT, STOCK_TOKEN_PROGRAM_ID],
    ['quote', QUOTE_MINT, QUOTE_TOKEN_PROGRAM_ID],
  ]) {
    const account = await provider.connection.getAccountInfo(mint, 'confirmed');
    if (!account || !account.owner.equals(tokenProgram))
      throw new Error(
        `Configured ${label} mint is missing or owned by another token program`,
      );
  }
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

  const protocolInfo = await provider.connection.getAccountInfo(
    protocolAccounts.protocolConfig,
    'confirmed',
  );
  if (protocolInfo) {
    const state = await program.account.protocolConfig.fetch(
      protocolAccounts.protocolConfig,
    );
    if (
      state.version !== 1 ||
      !state.authority.equals(provider.wallet.publicKey)
    )
      throw new Error(
        'Existing protocol authority or version differs from configured wallet',
      );
  }

  const marketInfo = await provider.connection.getAccountInfo(
    marketAccounts.market,
    'confirmed',
  );
  if (marketInfo) {
    const state = await program.account.market.fetch(marketAccounts.market);
    if (
      state.version !== 1 ||
      !state.authority.equals(provider.wallet.publicKey) ||
      !state.pythFeedId.eq(feedId) ||
      state.allowedSessionMask !== allowedSessionMask ||
      state.maxReferenceAgeSeconds !== maximumAgeSeconds ||
      !state.minimumStageRawAmount.eq(minimumStageRawAmount) ||
      !state.stockMint.equals(STOCK_MINT) ||
      !state.quoteMint.equals(QUOTE_MINT) ||
      !state.stockTokenProgram.equals(STOCK_TOKEN_PROGRAM_ID) ||
      !state.quoteTokenProgram.equals(QUOTE_TOKEN_PROGRAM_ID) ||
      state.supportedStockExtensions !== 1 ||
      !state.enabled
    )
      throw new Error('Existing Market differs from requested configuration');
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
  if (existingPolicy) {
    const policyState = await program.account.batchPolicy.fetch(policy);
    if (
      policyState.version !== 1 ||
      !policyState.market.equals(marketAccounts.market) ||
      Number(policyState.windowSeconds) !== windowSeconds ||
      Number(policyState.lockSeconds) !== lockSeconds
    )
      throw new Error(
        'Existing Batch policy differs from requested configuration',
      );
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
  if (existingSettlementPolicy) {
    const state =
      await program.account.settlementPolicy.fetch(settlementPolicy);
    if (
      state.version !== 1 ||
      !state.market.equals(marketAccounts.market) ||
      state.minimumPublisherCount !== minimumPublisherCount ||
      state.maximumConfidenceRatioBps !== maximumConfidenceRatioBps ||
      !state.reservationAuthority.equals(reservationAuthority)
    )
      throw new Error(
        'Existing settlement policy differs from requested configuration',
      );
  }

  if (checkOnly) {
    for (const [label, exists] of [
      ['Protocol', protocolInfo],
      ['Market', marketInfo],
      ['Batch policy', existingPolicy],
      ['Settlement policy', existingSettlementPolicy],
    ])
      process.stdout.write(
        `${label}: ${exists ? 'verified' : 'needs initialization'}\n`,
      );
  } else {
    if (!protocolInfo) {
      const signature = await program.methods.initializeProtocol().rpc();
      process.stdout.write(`Protocol initialized: ${signature}\n`);
    }
    if (!marketInfo) {
      const operation = program.methods
        .createMarket(marketArgs)
        .accountsPartial(marketBaseAccounts);
      await operation.simulate();
      const signature = await operation.rpc();
      process.stdout.write(`Market created: ${signature}\n`);
    }
    if (!existingPolicy) {
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
    if (!existingSettlementPolicy) {
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
  }

  process.stdout.write(
    `Protocol config: ${protocolAccounts.protocolConfig.toBase58()}\n`,
  );
  process.stdout.write(`Market: ${marketAccounts.market.toBase58()}\n`);
  process.stdout.write(`Batch policy: ${policy.toBase58()}\n`);
  process.stdout.write(`Settlement policy: ${settlementPolicy.toBase58()}\n`);
  process.stdout.write(`Program upgrade authority: ${upgradeAuthority}\n`);
  process.stdout.write(
    `Market authority: ${provider.wallet.publicKey.toBase58()}\n`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
