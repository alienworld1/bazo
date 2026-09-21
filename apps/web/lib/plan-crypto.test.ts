import { describe, expect, it } from 'vitest';
import {
  COMMITMENT_SCHEMA_VERSION,
  DEVNET_NETWORK_ID,
  buildCommitmentChain,
  encodeCanonicalStage,
  terminalCommitment,
  toHex,
  verifyCommitmentChain,
} from '@bazo/plan-crypto';

const plan = '11111111111111111111111111111111';
const market = 'SysvarC1ock11111111111111111111111111111111';
const salt = (byte: number) => new Uint8Array(32).fill(byte);

describe('Sell Plan commitments', () => {
  it('uses a fixed-width canonical Stage encoding', () => {
    const bytes = encodeCanonicalStage({
      schemaVersion: COMMITMENT_SCHEMA_VERSION,
      network: DEVNET_NETWORK_ID,
      plan,
      market,
      stageIndex: 0,
      rawQuantity: 2_500_001n,
      minPremiumBps: 50,
      allowedSessionMask: 1,
      maxReferenceAgeSeconds: 90,
      nextCommitment: salt(3),
      salt: salt(7),
    });

    expect(bytes).toHaveLength(13 + 2 + 1 + 32 + 32 + 2 + 8 + 4 + 1 + 4 + 32 + 32);
    expect(toHex(bytes)).toBe(
      '42415a4f5f53544147455f5631010001000000000000000000000000000000000000000000000000000000000000000006a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b21000000000000a12526000000000032000000015a00000003030303030303030303030303030303030303030303030303030303030303030707070707070707070707070707070707070707070707070707070707070707',
    );
  });

  it('constructs a Plan-bound terminal and linked chain', async () => {
    const stages = [
      {
        schemaVersion: COMMITMENT_SCHEMA_VERSION,
        network: DEVNET_NETWORK_ID,
        plan,
        market,
        stageIndex: 0,
        rawQuantity: 5_000_000n,
        minPremiumBps: 50,
        allowedSessionMask: 1,
        maxReferenceAgeSeconds: 90,
        salt: salt(1),
      },
      {
        schemaVersion: COMMITMENT_SCHEMA_VERSION,
        network: DEVNET_NETWORK_ID,
        plan,
        market,
        stageIndex: 1,
        rawQuantity: 5_000_000n,
        minPremiumBps: 100,
        allowedSessionMask: 1,
        maxReferenceAgeSeconds: 90,
        salt: salt(2),
      },
    ];
    const chain = await buildCommitmentChain(stages);

    expect(chain.headCommitment).not.toEqual(await terminalCommitment(plan, market));
    await expect(verifyCommitmentChain(chain.stages)).resolves.toEqual(chain.headCommitment);

    const altered = chain.stages.map(stage => ({ ...stage }));
    const first = altered[0];
    if (!first) throw new Error('test setup failed');
    first.minPremiumBps = 51;
    await expect(verifyCommitmentChain(altered)).rejects.toThrow('does not match');
  });
});
