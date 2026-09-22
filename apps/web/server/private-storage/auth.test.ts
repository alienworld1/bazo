import { generateKeyPairSync, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { createStorageChallenge, readStorageSession, verifyStorageChallenge } from './auth';

const decoder = getBase58Decoder();

describe('private storage authorization', () => {
  it('consumes origin-bound wallet challenges and creates short-lived sessions', () => {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
    const owner = decoder.decode(publicKey);
    const challenge = createStorageChallenge(owner, 'https://bazo.example');
    const signature = sign(null, Buffer.from(challenge.message), pair.privateKey).toString('base64url');
    const session = verifyStorageChallenge(challenge.challengeId, owner, signature, 'a'.repeat(32));
    expect(session).toBeDefined();
    expect(readStorageSession(session?.value, 'a'.repeat(32))).toBe(owner);
    expect(verifyStorageChallenge(challenge.challengeId, owner, signature, 'a'.repeat(32))).toBeUndefined();
  });
});
