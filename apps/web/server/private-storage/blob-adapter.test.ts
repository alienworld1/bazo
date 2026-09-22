import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommitmentChain, encryptPlanPackage, wrapPlanKeyWithWalletSignature, type PrivatePlanBlobRecordV1 } from '@bazo/plan-crypto';
import { describe, expect, it } from 'vitest';
import { LocalPrivatePlanBlobAdapter } from './blob-adapter';

const plan = '11111111111111111111111111111111';
const market = 'SysvarC1ock11111111111111111111111111111111';
const owner = 'SysvarRent111111111111111111111111111111111';

async function record() {
  const stages = await buildCommitmentChain([0, 1].map(stageIndex => ({ schemaVersion: 1, network: 1, plan, market, stageIndex, rawQuantity: 5n, minPremiumBps: 100, allowedSessionMask: 1, maxReferenceAgeSeconds: 90, salt: new Uint8Array(32).fill(stageIndex + 1) })));
  const encrypted = await encryptPlanPackage({ packageVersion: 1, plan, market, owner, commitmentSchemaVersion: 1, stages: stages.stages, createdAt: 1 });
  return { recordVersion: 1, plan, owner, payload: encrypted.payload, recovery: await wrapPlanKeyWithWalletSignature(encrypted.planKey, new Uint8Array(64).fill(7), owner, plan), ciphertextHash: encrypted.payload.ciphertextHash, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as PrivatePlanBlobRecordV1;
}

describe('local private Plan blob adapter', () => {
  it('uses create-only, idempotent, and conditional writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bazo-private-'));
    try {
      const adapter = new LocalPrivatePlanBlobAdapter(directory);
      const value = await record();
      expect((await adapter.put(value)).kind).toBe('saved');
      expect((await adapter.put(value)).kind).toBe('idempotent');
      expect((await adapter.put({ ...value, ciphertextHash: 'x' }, undefined)).kind).toBe('conflict');
      expect((await adapter.get(owner, plan))?.ciphertextHash).toBe(value.ciphertextHash);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
