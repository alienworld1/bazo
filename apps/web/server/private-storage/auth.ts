import { createHmac, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { getBase58Encoder } from '@solana/kit';

const encoder = new TextEncoder();
const challengeLifetimeMs = 5 * 60 * 1_000;
const sessionLifetimeMs = 15 * 60 * 1_000;
const challenges = new Map<string, Challenge>();
const base58Encoder = getBase58Encoder();

type Challenge = { owner: string; message: string; expiresAt: number; used: boolean };

export function createStorageChallenge(owner: string, origin: string) {
  const id = toBase64Url(randomBytes(16));
  const nonce = toBase64Url(randomBytes(32));
  const expiresAt = Date.now() + challengeLifetimeMs;
  const message = `Bazo Devnet private storage authorization\nOrigin: ${origin}\nOwner: ${owner}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nPurpose: private-plan-storage\nThis signature is not a transaction.`;
  challenges.set(id, { owner, message, expiresAt, used: false });
  return { challengeId: id, message, expiresAt: new Date(expiresAt).toISOString() };
}

export function verifyStorageChallenge(challengeId: string, owner: string, signature: string, sessionSecret: string) {
  const challenge = challenges.get(challengeId);
  if (!challenge || challenge.used || challenge.owner !== owner || challenge.expiresAt < Date.now()) {
    if (challenge) challenge.used = true;
    return undefined;
  }
  challenge.used = true;
  try {
    const publicKey = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(base58Encoder.encode(owner))]);
    const valid = verify(null, encoder.encode(challenge.message), { key: publicKey, format: 'der', type: 'spki' }, Buffer.from(fromBase64Url(signature)));
    return valid ? createSession(owner, sessionSecret) : undefined;
  } catch { return undefined; }
}

export function readStorageSession(cookie: string | undefined, sessionSecret: string) {
  if (!cookie) return undefined;
  const [owner, expires, mac] = cookie.split('.');
  if (!owner || !expires || !mac || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return undefined;
  const expected = sessionMac(owner, expires, sessionSecret);
  const received = Buffer.from(mac);
  const expectedBytes = Buffer.from(expected);
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) return undefined;
  return owner;
}

function createSession(owner: string, secret: string) {
  const expires = String(Date.now() + sessionLifetimeMs);
  return { value: `${owner}.${expires}.${sessionMac(owner, expires, secret)}`, expiresAt: new Date(Number(expires)).toISOString(), maxAge: Math.floor(sessionLifetimeMs / 1_000) };
}

function sessionMac(owner: string, expires: string, secret: string) { return createHmac('sha256', secret).update(`${owner}\n${expires}`).digest('base64url'); }
function toBase64Url(value: Uint8Array) { return Buffer.from(value).toString('base64url'); }
function fromBase64Url(value: string) { if (!/^[A-Za-z0-9_-]{80,100}$/.test(value)) throw new Error('invalid signature'); return Buffer.from(value, 'base64url'); }
