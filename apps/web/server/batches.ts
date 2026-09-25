import 'server-only';
import { address } from '@solana/kit';
import {
  batchWindowStart,
  deriveBatchAddress,
  fetchBatch,
  fetchBatchPolicy,
  type PublicBatch,
} from '@bazo/sdk';
import { readChainUnixTimestamp } from './buy-requests';
import { coordinatorRequest } from './matching-ingress';
import { getEnvironment } from './env';

export async function readBatch(
  batchAddress: string,
): Promise<PublicBatch | null> {
  const env = getEnvironment();
  return fetchBatch({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    batchAddress,
  });
}

export async function readCurrentOpenBatch(
  market: string,
): Promise<PublicBatch | null> {
  const env = getEnvironment();
  const now = await readChainUnixTimestamp();
  const policy = await fetchBatchPolicy({
    rpcUrl: env.SOLANA_RPC_URL,
    programAddress: address(env.BAZO_PROGRAM_ID),
    market: address(market),
  });
  if (!policy) return null;
  const start = batchWindowStart(now, BigInt(policy.windowSeconds));
  const key = await deriveBatchAddress(
    address(env.BAZO_PROGRAM_ID),
    address(market),
    start,
  );
  const batch = await readBatch(key);
  return batch?.status === 'open' ? batch : null;
}

export async function readBatchAvailability(
  batchAddress: string,
): Promise<'match_ready' | 'candidate_pending_reference' | 'matching' | null> {
  try {
    const response = await coordinatorRequest(
      `/v1/batches/${batchAddress}`,
      'GET',
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { status?: string };
    return data.status === 'match_ready'
      ? 'match_ready'
      : data.status === 'candidate_pending_reference'
        ? 'candidate_pending_reference'
        : data.status === 'matching'
          ? 'matching'
          : null;
  } catch {
    return null;
  }
}
