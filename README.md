# Bazo

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Replace every Market placeholder with verified Solana Devnet and Pyth Pro identifiers. Do not use guessed addresses or feed IDs.
3. Run `pnpm install`, then `pnpm dev`.

The Pyth key and a credential-bearing RPC URL are server-only. The app exposes only normalized public Market and reference data.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the repository root.
