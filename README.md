# Bazo

## Local setup

1. Copy `.env.example` to `.env.local` in the workspace root. The web app loads
   this shared file as well as any app-specific environment file.
2. Replace every Market placeholder with verified Solana Devnet and Pyth Pro identifiers. Do not use guessed addresses or feed IDs.
3. Configure `BAZO_AUTH_SESSION_SECRET` with at least 32 random characters and
   `BAZO_PRIVATE_BLOB_DIRECTORY` with an absolute path or a workspace-relative
   private directory.
4. Run `pnpm install`, then `pnpm dev`.

The Pyth key and a credential-bearing RPC URL are server-only. The app exposes only normalized public Market and reference data.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the repository root.
