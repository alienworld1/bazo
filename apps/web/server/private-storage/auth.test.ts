import { generateKeyPairSync, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStorageChallenge,
  readStorageSession,
  verifyStorageChallenge,
} from './auth';

const decoder = getBase58Decoder();

afterEach(() => vi.useRealTimers());

describe('private storage authorization', () => {
  it('consumes origin-bound wallet challenges and creates short-lived sessions', () => {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32);
    const owner = decoder.decode(publicKey);
    const challenge = createStorageChallenge(owner, 'https://bazo.example');
    const signature = sign(
      null,
      Buffer.from(challenge.message),
      pair.privateKey,
    ).toString('base64url');
    const session = verifyStorageChallenge(
      challenge.challengeId,
      owner,
      signature,
      'a'.repeat(32),
    );
    expect(session).toBeDefined();
    expect(readStorageSession(session?.value, 'a'.repeat(32))).toBe(owner);
    expect(
      verifyStorageChallenge(
        challenge.challengeId,
        owner,
        signature,
        'a'.repeat(32),
      ),
    ).toBeUndefined();
  });

  it('rejects expired challenges', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const pair = generateKeyPairSync('ed25519');
    const owner = decoder.decode(
      pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
    );
    const challenge = createStorageChallenge(owner, 'https://bazo.example');
    const signature = sign(
      null,
      Buffer.from(challenge.message),
      pair.privateKey,
    ).toString('base64url');

    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    expect(
      verifyStorageChallenge(
        challenge.challengeId,
        owner,
        signature,
        'a'.repeat(32),
      ),
    ).toBeUndefined();
  });
});
