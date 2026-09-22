import { describe, expect, it } from 'vitest';
import {
  buildCommitmentChain,
  createBackup,
  decryptPlanPackage,
  encryptPlanPackage,
  parseBackup,
  parsePrivatePlanPackage,
  serializeBackup,
  serializePrivatePlanPackage,
  unlockBackup,
  unwrapPlanKeyWithWalletSignature,
  verifyRestoredPackage,
  wrapPlanKeyWithWalletSignature,
} from '@bazo/plan-crypto';

const plan = '11111111111111111111111111111111';
const market = 'SysvarC1ock11111111111111111111111111111111';
const owner = 'SysvarRent111111111111111111111111111111111';

async function fixture() {
  const chain = await buildCommitmentChain(
    [0, 1].map(stageIndex => ({
      schemaVersion: 1,
      network: 1,
      plan,
      market,
      stageIndex,
      rawQuantity: 5n,
      minPremiumBps: 100,
      allowedSessionMask: 1,
      maxReferenceAgeSeconds: 90,
      salt: new Uint8Array(32).fill(stageIndex + 1),
    })),
  );
  return {
    packageVersion: 1 as const,
    plan,
    market,
    owner,
    commitmentSchemaVersion: 1 as const,
    stages: chain.stages,
    createdAt: 1,
  };
}

describe('private Plan recovery', () => {
  it('round trips encrypted packages and rejects changed metadata', async () => {
    const privatePackage = await fixture();
    expect(
      parsePrivatePlanPackage(serializePrivatePlanPackage(privatePackage)),
    ).toEqual(privatePackage);
    const { planKey, payload } = await encryptPlanPackage(privatePackage);
    await expect(decryptPlanPackage(payload, planKey)).resolves.toEqual(
      privatePackage,
    );
    await expect(
      decryptPlanPackage({ ...payload, owner: plan }, planKey),
    ).rejects.toThrow();
    const changedCiphertext = `${payload.encryptedPlanPackage.startsWith('A') ? 'B' : 'A'}${payload.encryptedPlanPackage.slice(1)}`;
    await expect(
      decryptPlanPackage(
        { ...payload, encryptedPlanPackage: changedCiphertext },
        planKey,
      ),
    ).rejects.toThrow();
  });

  it('exports a passphrase backup and verifies current chain state', async () => {
    const privatePackage = await fixture();
    const { planKey, payload } = await encryptPlanPackage(privatePackage);
    const backup = await createBackup(
      payload,
      planKey,
      'a long recovery passphrase',
      2,
    );
    const parsed = parseBackup(serializeBackup(backup));
    const unlocked = await unlockBackup(parsed, 'a long recovery passphrase');
    await verifyRestoredPackage(unlocked.package, {
      address: plan,
      owner,
      market,
      currentStageIndex: 1,
      currentCommitment: Array.from(
        privatePackage.stages[1]!.commitment,
        byte => byte.toString(16).padStart(2, '0'),
      ).join(''),
      initialRawInventory: '10',
    });
    await expect(
      unlockBackup(parsed, 'a different recovery passphrase'),
    ).rejects.toThrow();
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, unexpected: true })),
    ).toThrow();
    const changedChecksum = `${backup.checksum.startsWith('A') ? 'B' : 'A'}${backup.checksum.slice(1)}`;
    const changedBackup = parseBackup(
      serializeBackup({ ...backup, checksum: changedChecksum }),
    );
    await expect(
      unlockBackup(changedBackup, 'a long recovery passphrase'),
    ).rejects.toThrow('checksum');
  });

  it('uses fresh nonces and rejects a package with a changed commitment', async () => {
    const privatePackage = await fixture();
    const first = await encryptPlanPackage(privatePackage);
    const second = await encryptPlanPackage(privatePackage);
    expect(first.payload.payloadNonce).not.toBe(second.payload.payloadNonce);
    const stages = privatePackage.stages.map((stage, index) =>
      index === 0
        ? { ...stage, commitment: new Uint8Array(stage.commitment).fill(9) }
        : stage,
    );
    await expect(
      encryptPlanPackage({ ...privatePackage, stages }),
    ).rejects.toThrow('commitment');
  });

  it('derives wallet wrapping keys through a Plan-bound KDF', async () => {
    const key = new Uint8Array(32).fill(3);
    const signature = new Uint8Array(64).fill(7);
    const wrapped = await wrapPlanKeyWithWalletSignature(
      key,
      signature,
      owner,
      plan,
    );
    await expect(
      unwrapPlanKeyWithWalletSignature(wrapped, signature, owner, plan),
    ).resolves.toEqual(key);
    await expect(
      unwrapPlanKeyWithWalletSignature(
        wrapped,
        new Uint8Array(64).fill(8),
        owner,
        plan,
      ),
    ).rejects.toThrow();
  });
});
