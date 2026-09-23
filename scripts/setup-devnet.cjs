#!/usr/bin/env node

const anchor = require('@anchor-lang/core');
const idl = require('../target/idl/bazo.json');

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);
const STOCK_MINT = new anchor.web3.PublicKey(
  '3bEb8QPW7edXzvcm1udGcRjr6NfpbvyXrwAdK5upXUTQ',
);
const QUOTE_MINT = new anchor.web3.PublicKey(
  'EDJpD3ngqiy5ZhWZjDNYZDzCuTvkW42ea72X6TAuDeL3',
);

async function main() {
  const provider = anchor.AnchorProvider.local(DEVNET_RPC_URL);
  const program = new anchor.Program(idl, provider);
  const baseAccounts = {
    authority: provider.wallet.publicKey,
    stockMint: STOCK_MINT,
    quoteMint: QUOTE_MINT,
    stockTokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  const protocolAccounts = await program.methods.initializeProtocol().pubkeys();
  const marketBaseAccounts = {
    ...baseAccounts,
    protocolConfig: protocolAccounts.protocolConfig,
  };
  const marketAccounts = await program.methods
    .createMarket({
      pythFeedId: new anchor.BN(1435),
      allowedSessionMask: 1,
      maxReferenceAgeSeconds: 90,
      minimumStageRawAmount: new anchor.BN(1),
      supportedStockExtensions: 1,
    })
    .accountsPartial(marketBaseAccounts)
    .pubkeys();

  if (
    !(await provider.connection.getAccountInfo(protocolAccounts.protocolConfig))
  ) {
    const signature = await program.methods.initializeProtocol().rpc();
    process.stdout.write(`Protocol initialized: ${signature}\n`);
  } else {
    process.stdout.write('Protocol configuration already exists.\n');
  }

  if (!(await provider.connection.getAccountInfo(marketAccounts.market))) {
    const signature = await program.methods
      .createMarket({
        pythFeedId: new anchor.BN(1435),
        allowedSessionMask: 1,
        maxReferenceAgeSeconds: 90,
        minimumStageRawAmount: new anchor.BN(1),
        supportedStockExtensions: 1,
      })
      .accountsPartial(marketBaseAccounts)
      .rpc();
    process.stdout.write(`Market created: ${signature}\n`);
  } else {
    process.stdout.write('Market already exists.\n');
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

  process.stdout.write(`Protocol config: ${protocolAccounts.protocolConfig.toBase58()}\n`);
  process.stdout.write(`Market: ${marketAccounts.market.toBase58()}\n`);
  process.stdout.write(`Batch policy: ${policy.toBase58()}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
