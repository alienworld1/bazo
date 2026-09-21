'use client';

import { createClient } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { walletSigner } from '@solana/kit-plugin-wallet';

export const solanaClient = createClient()
  .use(walletSigner({ chain: 'solana:devnet' }))
  .use(solanaDevnetRpc());
