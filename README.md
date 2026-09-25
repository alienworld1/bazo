# Bazo

Bazo is a Solana application for selling tokenized stock through a precommitted sequence of Sell Plan stages. A holder deposits stock and fixes the quantity and minimum premium for each stage in advance. Buyers escrow quote tokens in Buy Requests. When a batch contains enough compatible demand, the current stage can settle against a signed Pyth reference; future stages remain sealed until their turn.

The repository includes a wallet-connected web app, an Anchor program, a matching coordinator, and shared TypeScript packages. It is configured for one curated Devnet market. It is not a general token exchange.

## Sell Plans and Buy Requests

A Sell Plan contains **2–6 ordered stages**. Each stage specifies a raw stock quantity, minimum premium, allowed market sessions, and maximum age for the underlying price reference. The browser hashes the stages into a linked commitment chain and funds a program-owned stock vault. The chain stores the current commitment, inventory, proceeds accounting, and status. It does not store the future stage terms.

The seller retains the private stage openings. Bazo can export them as an encrypted `.bazo` backup protected by a recovery passphrase. The optional private-copy service stores ciphertext and a wallet-wrapped recovery key; access requires a signed wallet challenge. If the seller loses the openings, the plan cannot continue matching, but its remaining stock can still be recovered after the relevant lock clears and the plan is canceled or expires.

A Buy Request commits to a target stock quantity, maximum premium, and partial-fill preference. Its buyer deposits a maximum quote amount into a request-specific escrow and sets an expiry and stock recipient. The private matching terms are delivered to the coordinator only after the web server checks them against the onchain commitment. Quote that was not spent can be refunded under the program's request rules.

The app exposes market reference and supported holding information, plan and request status, batch state, sale receipts, wallet positions, and recent activity. These views read public state from Solana; the browser also keeps the owner's private material for delivery and recovery.

## Batches and settlement

The coordinator opens a Batch for each configured time window, collects eligible requests, and locks a fixed set after the window ends. The default policy created by `setup:devnet` uses a **45-second window** and a **120-second lock lifetime**. A Batch contains at most four requests. The coordinator refuses to lock a window with more than four verified eligible requests rather than silently dropping any of them.

For each locked Batch, the matching code sorts buyers by maximum premium, then creation slot and address. It considers sellers by minimum premium, then plan creation time and address. A proposal must cover the **entire current stage**; a buyer who disallows partial fills is skipped if their remaining quantity exceeds the stage remainder. The last accepted buyer sets the uniform marginal premium. A proposal is only a candidate until quote affordability has been checked against a fresh signed reference.

To settle, the coordinator reserves the selected plan stage and submits the stage opening, request openings, and signed Pyth update. The [Anchor program](programs/bazo/src/settlement.rs) rechecks the commitments and allocation, verifies the reference through the Pyth verifier, calculates quote charges using the stock mint's scaled UI amount, and enforces each buyer's escrow limit. In the same transaction it transfers stock to buyer recipients and quote into the plan's proceeds vault, records a receipt, and advances the plan commitment. Settlement consumes a stage completely; it does not partially advance one.

An expired Batch can be released by any caller after its onchain deadline. That clears request locks so owners can recover funds even if the coordinator stops. The coordinator's openings and candidate proposals are kept in memory, so they must be delivered again after a restart. Batch locks, vault balances, receipts, and ownership remain onchain. The [batch protocol](docs/batch-protocol.md) specifies window identity, ordering, and expiry rules.

## Local development

### Prerequisites

- Node.js 20.18 or newer and pnpm 12.4.2.
- A Solana Devnet wallet and an RPC endpoint. The wallet needs SOL for transactions and the relevant stock or quote tokens for the action being tested.
- Access to a Pyth Pro API key for market references and settlement.
- An already deployed Bazo program and initialized market, Batch policy, and settlement policy. If you are deploying your own, you also need Rust, the Solana CLI, and the Anchor and Solana versions listed in [Anchor.toml](Anchor.toml).

The example environment file intentionally contains placeholders. A clean clone will not transact until its program, mint, feed, and authority values match the same Devnet market. The [Devnet release runbook](docs/release-runbook.md) covers building, deployment checks, initialization, and test assets.

```bash
pnpm install
cp .env.example .env.local
```

Edit the root `.env.local`. Both the web app and coordinator load it. These are the settings that need particular attention:

| Setting | Purpose |
| --- | --- |
| `SOLANA_RPC_URL`, `BAZO_PROGRAM_ID` | Devnet RPC and the deployed program to read and transact against. |
| `BAZO_MARKET_*`, `BAZO_STOCK_*`, `BAZO_QUOTE_*` | Display identity, mint addresses, token programs, and amount configuration for the one supported market. |
| `BAZO_PYTH_FEED_ID`, `PYTH_API_KEY` | The feed for the underlying stock and the server-side Pyth Pro credential. |
| `BAZO_ALLOWED_SESSIONS`, `BAZO_MAX_REFERENCE_AGE_SECONDS`, `BAZO_MIN_PUBLISHER_COUNT`, `BAZO_MAX_CONFIDENCE_RATIO_BPS` | Reference conditions used by the market and settlement policy. |
| `BAZO_BATCH_DURATION_SECONDS`, `BAZO_BATCH_LOCK_SECONDS` | Window and lock lifetimes. They must match the initialized onchain Batch policy. |
| `BAZO_COORDINATOR_FEE_PAYER_PATH` | Path to an existing funded Solana keypair used by the coordinator for Batch and settlement transactions. Store the keypair outside the repository. |
| `BAZO_COORDINATOR_URL`, `BAZO_COORDINATOR_SECRET` | Loopback address and shared secret for web-to-coordinator delivery. The secret must have at least 32 characters. |
| `BAZO_AUTH_SESSION_SECRET` | Separate secret of at least 32 characters for wallet-authenticated private delivery and storage. |
| `BAZO_PRIVATE_BLOB_DIRECTORY` | Optional private directory for encrypted plan copies. Local `.bazo` backups work without it. |

Keep `PYTH_API_KEY`, the RPC credential if present, both secrets, and keypair files out of public assets and version control. The coordinator listens on `127.0.0.1:3145` by default. Its web callback defaults to `http://127.0.0.1:3000/`; set `BAZO_WEB_BASE_URL` if the web server runs at another local origin.

Start the web app and coordinator in separate terminals:

```bash
pnpm dev
pnpm dev:coordinator
```

Open <http://localhost:3000>. The market page shows the configured token pair and reference state. Connect a Devnet wallet to fund a Sell Plan or Buy Request, then use the plan, request, Batch, Portfolio, and Activity pages to follow the result. The coordinator must be running for private opening delivery and automatic batch settlement; owner exits are enforced by the program.

### Deploying or verifying a market

`pnpm build:program` produces the Anchor IDL and SBF v2 program artifact. After deploying the artifact with the Solana CLI, run `pnpm setup:devnet -- --check` with the intended Market authority wallet to compare the deployed bytes, program authority, configured mints, and existing accounts. `pnpm setup:devnet` initializes missing protocol, Market, Batch, and settlement policy accounts; it rejects mismatched existing configuration. These commands require the built program artifact, an appropriate keypair, and a configured Devnet RPC. The full sequence is in the [release runbook](docs/release-runbook.md).

## Repository layout

| Path | Responsibility |
| --- | --- |
| [`apps/web`](apps/web) | Next.js interface, wallet actions, public reads, Pyth reference endpoint, and authenticated private-delivery routes. |
| [`programs/bazo`](programs/bazo) | Anchor accounts and instructions for custody, escrow, batches, settlement, claims, refunds, and exits. |
| [`services/coordinator`](services/coordinator) | Loopback service that receives verified private openings, opens and locks Batches, proposes matches, and submits settlement transactions. |
| [`packages/sdk`](packages/sdk) | Account readers, instruction builders, canonical request encoding, matching rules, and settlement calculations. |
| [`packages/plan-crypto`](packages/plan-crypto) | Stage commitment chains, encryption, backup, and wallet-based recovery formats. |

## Checks

Run the local checks from the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace
```

`pnpm test` runs web, SDK, and coordinator tests. `cargo test --workspace` runs program unit tests. `pnpm release:check` adds the program build, read-only Devnet account verification, and a browser bundle scan for configured secrets; it needs a complete Devnet environment. The [release runbook](docs/release-runbook.md) also describes local-validator custody tests and the disposable Devnet lifecycle check.

## Current scope

The app supports one configured Solana Devnet market using Token-2022 stock with `ScaledUiAmountConfig` and a compatible quote mint. It does not expose permissionless market creation or a production deployment. The release runbook records verified deployment and Batch lifecycle checks, while a confirmed live Pyth-signed settlement receipt remains outstanding. Treat live end-to-end settlement as unverified until that check is completed.
