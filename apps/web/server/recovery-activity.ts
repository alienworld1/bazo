import 'server-only';

import { address, createSolanaRpc, getBase58Decoder } from '@solana/kit';
import { fetchBatch } from '@bazo/sdk';
import { getEnvironment } from './env';

const decoder = getBase58Decoder();
const definitions = [
  { name: 'PlanCanceled', title: 'Sell Plan canceled', kind: 'plan' },
  { name: 'RemainingStockWithdrawn', title: 'Stock returned', kind: 'plan' },
  { name: 'PlanProceedsClaimed', title: 'Proceeds claimed', kind: 'plan' },
  {
    name: 'BuyRequestCanceled',
    title: 'Request canceled · quote returned',
    kind: 'request',
  },
  {
    name: 'BuyRequestRefunded',
    title: 'Unused quote refunded',
    kind: 'request',
  },
  { name: 'BatchExpired', title: 'Batch released', kind: 'request' },
] as const;

export type RecoveryActivity = {
  id: string;
  title: string;
  detail: string;
  href: string;
  occurredAtUnix: string | null;
  signature: string;
};

export async function readRecoveryActivity(
  subject: string,
  owner: string,
  kind: 'plan' | 'request',
): Promise<{ items: RecoveryActivity[]; partial: boolean }> {
  const env = getEnvironment();
  const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
  const signatures = await rpc
    .getSignaturesForAddress(address(subject), {
      limit: 8,
      commitment: 'confirmed',
    })
    .send();
  const discriminators = await Promise.all(
    definitions
      .filter(item => item.kind === kind)
      .map(async item => ({
        ...item,
        bytes: new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`event:${item.name}`),
          ),
        ).slice(0, 8),
      })),
  );
  const items: RecoveryActivity[] = [];
  let partial = signatures.length === 8;
  for (const candidate of signatures) {
    if (candidate.err) continue;
    try {
      const transaction = await rpc
        .getTransaction(candidate.signature, {
          encoding: 'json',
          maxSupportedTransactionVersion: 1,
          commitment: 'confirmed',
        })
        .send();
      if (
        !transaction ||
        transaction.meta?.err ||
        !transaction.meta?.logMessages
      ) {
        partial = true;
        continue;
      }
      const programCalled = transaction.transaction.message.instructions.some(
        instruction =>
          transaction.transaction.message.accountKeys[
            instruction.programIdIndex
          ] === env.BAZO_PROGRAM_ID,
      );
      const subjectIncluded = transaction.transaction.message.accountKeys.some(
        key => key === subject,
      );
      if (!programCalled || !subjectIncluded) continue;
      const invocationStack: string[] = [];
      for (const line of transaction.meta.logMessages) {
        const entered = /^Program (\S+) invoke \[\d+\]$/.exec(line);
        if (entered) {
          invocationStack.push(entered[1]);
          continue;
        }
        const exited = /^Program (\S+) (?:success|failed:.*)$/.exec(line);
        if (exited) {
          if (invocationStack.at(-1) === exited[1]) invocationStack.pop();
          continue;
        }
        if (
          !line.startsWith('Program data: ') ||
          invocationStack.at(-1) !== env.BAZO_PROGRAM_ID
        )
          continue;
        const data = Uint8Array.from(Buffer.from(line.slice(14), 'base64'));
        const definition = discriminators.find(item =>
          item.bytes.every((byte, index) => data[index] === byte),
        );
        if (!definition) continue;
        if (definition.name === 'BatchExpired') {
          if (data.length !== 40) continue;
          const batchAddress = decoder.decode(data.slice(8, 40));
          const batch = await fetchBatch({
            rpcUrl: env.SOLANA_RPC_URL,
            programAddress: address(env.BAZO_PROGRAM_ID),
            batchAddress,
          });
          if (
            !batch ||
            batch.status !== 'expired' ||
            !batch.requests.includes(subject)
          )
            continue;
          items.push({
            id: `BatchExpired:${candidate.signature}:${subject}`,
            title: definition.title,
            detail:
              'The matching lock ended without a sale. Unused quote can now be recovered.',
            href: `/batches/${batchAddress}`,
            occurredAtUnix: transaction.blockTime?.toString() ?? null,
            signature: candidate.signature,
          });
          continue;
        }
        if (data.length < 72) continue;
        if (
          decoder.decode(data.slice(8, 40)) !== subject ||
          decoder.decode(data.slice(40, 72)) !== owner
        )
          continue;
        const raw =
          data.length >= 80
            ? new DataView(data.buffer, data.byteOffset, data.byteLength)
                .getBigUint64(72, true)
                .toString()
            : null;
        items.push({
          id: `${definition.name}:${candidate.signature}`,
          title: definition.title,
          detail:
            raw === null
              ? 'The remaining path ended; completed sales remain final.'
              : `${raw} raw ${definition.name === 'RemainingStockWithdrawn' ? 'stock' : 'quote'} units returned or claimed`,
          href: `/${kind === 'plan' ? 'sell-plans' : 'buy-requests'}/${subject}`,
          occurredAtUnix: transaction.blockTime?.toString() ?? null,
          signature: candidate.signature,
        });
      }
    } catch {
      partial = true;
    }
  }
  return { items, partial };
}
