import { readFileSync } from 'node:fs';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from '@solana/kit';
import {
  batchWindowStart,
  compareAddressBytes,
  deriveBatchAddress,
  deriveMarketAddress,
  expireBatchInstruction,
  fetchBatch,
  fetchBatchPolicy,
  fetchBuyRequest,
  lockBatchInstruction,
  MAX_BATCH_REQUESTS,
  openBatchInstruction,
  type BuyRequestOpeningV1,
  type PublicBatch,
} from '@bazo/sdk';

type StoredRequest = {
  opening: BuyRequestOpeningV1;
  fingerprint: string;
  deliveredAt: bigint;
};

type CrankInput = {
  rpcUrl: string;
  programAddress: Address;
  stockMint: Address;
  quoteMint: Address;
  requests: Map<string, StoredRequest>;
  readChainTime: () => Promise<bigint>;
  verifyRequest: (opening: BuyRequestOpeningV1) => Promise<string>;
  settleLockedBatch: (
    batch: PublicBatch,
    caller: Address,
    send: (instructions: Instruction | Instruction[]) => Promise<void>,
  ) => Promise<void>;
};

export async function startCrank(input: CrankInput): Promise<void> {
  const path = process.env.BAZO_COORDINATOR_FEE_PAYER_PATH;
  if (!path) throw new Error('missing coordinator fee payer path');
  const bytes: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)
  )
    throw new Error('invalid coordinator fee payer');
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  const rpc = createSolanaRpc(input.rpcUrl);
  const market = await deriveMarketAddress(input.programAddress, {
    stockMint: input.stockMint,
    quoteMint: input.quoteMint,
  });
  const policy = await fetchBatchPolicy({
    rpcUrl: input.rpcUrl,
    programAddress: input.programAddress,
    market,
  });
  if (!policy) throw new Error('Batch policy has not been initialized');
  const duration = BigInt(policy.windowSeconds);
  let busy = false;

  const send = async (
    instructions: Instruction | Instruction[],
  ): Promise<void> => {
    const { value: blockhash } = await rpc
      .getLatestBlockhash({ commitment: 'confirmed' })
      .send();
    const message = setTransactionMessageLoadedAccountsDataSizeLimit(
      64 * 1024 * 1024,
      setTransactionMessageComputeUnitLimit(
        1_400_000,
        appendTransactionMessageInstructions(
          Array.isArray(instructions) ? instructions : [instructions],
          setTransactionMessageLifetimeUsingBlockhash(
            blockhash,
            setTransactionMessageFeePayerSigner(
              signer,
              createTransactionMessage({ version: 1 }),
            ),
          ),
        ),
      ),
    );
    const wire = getBase64EncodedWireTransaction(compileTransaction(message));
    if (Buffer.from(wire, 'base64').length > 4096)
      throw new Error('transaction exceeds Solana packet limit');
    const simulation = await rpc
      .simulateTransaction(wire, {
        encoding: 'base64',
        commitment: 'confirmed',
        sigVerify: false,
      })
      .send();
    if (simulation.value.err) throw new Error('batch simulation failed');
    const signed = await signTransactionMessageWithSigners(message);
    const signature = await rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      .send();
    for (let attempt = 0; attempt < 15; attempt++) {
      const result = await rpc.getSignatureStatuses([signature]).send();
      const status = result.value[0];
      if (status?.err) throw new Error('transaction failed');
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      )
        return;
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    throw new Error('transaction confirmation uncertain');
  };

  const readBatch = async (start: bigint): Promise<PublicBatch | null> => {
    const key = await deriveBatchAddress(input.programAddress, market, start);
    return fetchBatch({
      rpcUrl: input.rpcUrl,
      programAddress: input.programAddress,
      batchAddress: key,
    });
  };

  const eligible = async (batch: PublicBatch) => {
    const result: { request: Address; escrow: Address }[] = [];
    for (const stored of input.requests.values()) {
      if (
        stored.opening.market !== batch.market ||
        stored.deliveredAt >= BigInt(batch.windowEnd)
      )
        continue;
      try {
        if ((await input.verifyRequest(stored.opening)) !== stored.fingerprint)
          continue;
        const request = await fetchBuyRequest({
          rpcUrl: input.rpcUrl,
          programAddress: input.programAddress,
          requestAddress: stored.opening.request,
        });
        if (
          !request ||
          BigInt(request.createdAt) < BigInt(batch.windowStart) ||
          BigInt(request.createdAt) >= BigInt(batch.windowEnd) ||
          BigInt(request.expiresAt) <= BigInt(batch.lockDeadline)
        )
          continue;
        result.push({
          request: address(request.address),
          escrow: address(request.escrow),
        });
      } catch {
        continue;
      }
    }
    return result.sort((a, b) => compareAddressBytes(a.request, b.request));
  };

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = await input.readChainTime();
      const start = batchWindowStart(now, duration);
      if (!(await readBatch(start))) {
        const { instruction } = await openBatchInstruction({
          programAddress: input.programAddress,
          caller: signer.address,
          market,
          windowStart: start,
        });
        await send(instruction);
      }
      const previous = await readBatch(start - duration);
      if (
        previous?.status === 'open' &&
        now >= BigInt(previous.windowEnd) &&
        now < BigInt(previous.lockDeadline)
      ) {
        const set = await eligible(previous);
        if (set.length > MAX_BATCH_REQUESTS)
          throw new Error('batch request cap exceeded');
        if (set.length > 0)
          await send(
            await lockBatchInstruction({
              programAddress: input.programAddress,
              caller: signer.address,
              market,
              batch: address(previous.address),
              requests: set,
            }),
          );
      }
      for (
        let offset = 1n;
        offset <= BigInt(policy.lockSeconds) / duration + 2n;
        offset++
      ) {
        const batch = await readBatch(start - offset * duration);
        if (batch?.status === 'locked' && now < BigInt(batch.lockDeadline))
          await input.settleLockedBatch(batch, signer.address, send);
        if (
          batch &&
          (batch.status === 'open' || batch.status === 'locked') &&
          now >= BigInt(batch.lockDeadline)
        )
          await send(
            await expireBatchInstruction({
              programAddress: input.programAddress,
              caller: signer.address,
              batch,
            }),
          );
      }
    } catch (error) {
      process.stderr.write(
        error instanceof Error && error.message === 'batch request cap exceeded'
          ? 'Too many verified requests for this Batch. Its open window will expire without a lock.\n'
          : 'Batch coordination is waiting for a confirmed chain state.\n',
      );
    } finally {
      busy = false;
      setTimeout(() => {
        void tick();
      }, 5_000);
    }
  };
  void tick();
}
