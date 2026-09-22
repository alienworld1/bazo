import { describe, expect, it } from 'vitest';
import { buildCommitmentChain, createBackup, decryptPlanPackage, encryptPlanPackage, parseBackup, parsePrivatePlanPackage, serializeBackup, serializePrivatePlanPackage, unlockBackup, verifyRestoredPackage } from '@bazo/plan-crypto';

const plan = '11111111111111111111111111111111';
const market = 'SysvarC1ock11111111111111111111111111111111';
const owner = 'SysvarRent111111111111111111111111111111111';

async function fixture() {
  const chain = await buildCommitmentChain([0, 1].map(stageIndex => ({ schemaVersion: 1, network: 1, plan, market, stageIndex, rawQuantity: 5n, minPremiumBps: 100, allowedSessionMask: 1, maxReferenceAgeSeconds: 90, salt: new Uint8Array(32).fill(stageIndex + 1) })));
  return { packageVersion: 1 as const, plan, market, owner, commitmentSchemaVersion: 1 as const, stages: chain.stages, createdAt: 1 };
}

describe('private Plan recovery', () => {
  it('round trips encrypted packages and rejects changed metadata', async () => {
    const privatePackage = await fixture();
    expect(parsePrivatePlanPackage(serializePrivatePlanPackage(privatePackage))).toEqual(privatePackage);
    const { planKey, payload } = await encryptPlanPackage(privatePackage);
    await expect(decryptPlanPackage(payload, planKey)).resolves.toEqual(privatePackage);
    await expect(decryptPlanPackage({ ...payload, owner: plan }, planKey)).rejects.toThrow();
  });

  it('exports a passphrase backup and verifies current chain state', async () => {
    const privatePackage = await fixture();
    const { planKey, payload } = await encryptPlanPackage(privatePackage);
    const backup = await createBackup(payload, planKey, 'a long recovery passphrase', 2);
    const parsed = parseBackup(serializeBackup(backup));
    const unlocked = await unlockBackup(parsed, 'a long recovery passphrase');
    await verifyRestoredPackage(unlocked.package, { address: plan, owner, market, currentStageIndex: 1, currentCommitment: Array.from(privatePackage.stages[1]!.commitment, byte => byte.toString(16).padStart(2, '0')).join(''), initialRawInventory: '10' });
    await expect(unlockBackup(parsed, 'a different recovery passphrase')).rejects.toThrow();
  });
});
