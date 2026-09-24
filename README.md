# Bazo

## Local setup

1. Copy `.env.example` to `.env.local` in the workspace root. The web app loads
   this shared file as well as any app-specific environment file.
2. Replace every Market placeholder with verified Solana Devnet and Pyth Pro identifiers. Do not use guessed addresses or feed IDs.
3. Configure `BAZO_AUTH_SESSION_SECRET` with at least 32 random characters and
   `BAZO_PRIVATE_BLOB_DIRECTORY` with an absolute path or a workspace-relative
   private directory.
4. Run `pnpm install`, then `pnpm dev`.

## Batch coordination

The coordinator runs separately from the web app. Build and deploy the current
program with `pnpm build:program` and your normal Solana deployment command,
then run `pnpm setup:devnet` as the Market authority to initialize the immutable
Batch policy. The configured window is 45 seconds and its lock lifetime is 120
seconds unless the setup environment supplies another valid value.

Set `BAZO_COORDINATOR_SECRET` to the same random value of at least 32 characters
for the web app and coordinator. Set `BAZO_COORDINATOR_URL` to its loopback URL,
`BAZO_COORDINATOR_FEE_PAYER_PATH` to an existing local Solana CLI keypair file,
and `BAZO_WEB_BASE_URL` to the local web URL. Keep keypair contents out of env
files and the repository. Start the process with `pnpm dev:coordinator` alongside
`pnpm dev`. The coordinator signs only Batch open, lock, and expiry transactions;
it does not settle trades. Its private openings and candidate proposals are held
in memory, so owners must redeliver them after a restart. Public Batch and lock
state is read from Solana after restart.

See [Batch protocol contract](docs/batch-protocol.md) for window identity, set
ordering, limits, and timeout recovery.

For a repeatable Devnet check, run this from `services/coordinator` with the
configured root `.env`:

```bash
ANCHOR_WALLET=/absolute/path/to/keypair.json node --env-file=../../.env --import tsx devnet-qa.mjs
```

The check funds disposable Plan and request fixtures, compares proposals across process
restarts, expires a lock from a separate wallet, and verifies buyer refunds.
It keeps owner-only opening recovery files in the ignored `target/devnet-qa`
directory; keep them until the disposable Plans are no longer needed.

The Pyth key and a credential-bearing RPC URL are server-only. The app exposes only normalized public Market and reference data.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the repository root.
