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

  if (!(await provider.connection.getAccountInfo(protocolAccounts.protocolConfig))) {
    const signature = await program.methods.initializeProtocol().rpc();
    console.log(`Protocol initialized: ${signature}`);
  } else {
    console.log('Protocol configuration already exists.');
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
    console.log(`Market created: ${signature}`);
  } else {
    console.log('Market already exists.');
  }

  console.log(`Protocol config: ${protocolAccounts.protocolConfig.toBase58()}`);
  console.log(`Market: ${marketAccounts.market.toBase58()}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
