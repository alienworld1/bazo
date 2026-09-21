import { getBase58Decoder } from '@solana/kit';

const planDiscriminator = Uint8Array.of(161, 231, 251, 119, 2, 12, 162, 2);
export const PLAN_ACCOUNT_DATA_LENGTH = 238;
const base58Decoder = getBase58Decoder();

export type PublicSellPlan = {
  address: string;
  owner: string;
  market: string;
  stockVault: string;
  proceedsVault: string;
  initialRawInventory: string;
  remainingRawInventory: string;
  status: 'active' | 'unknown';
  currentStageIndex: number;
  currentCommitmentFingerprint: string;
  createdAt: string;
  expiresAt: string;
};

export function decodePublicSellPlan(
  data: Uint8Array,
  planAddress: string,
): PublicSellPlan | null {
  if (
    data.length !== PLAN_ACCOUNT_DATA_LENGTH ||
    !sameBytes(data.slice(0, 8), planDiscriminator)
  ) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const commitment = data.slice(180, 212);

  return {
    address: planAddress,
    owner: base58Decoder.decode(data.slice(10, 42)),
    market: base58Decoder.decode(data.slice(42, 74)),
    stockVault: base58Decoder.decode(data.slice(74, 106)),
    proceedsVault: base58Decoder.decode(data.slice(106, 138)),
    initialRawInventory: view.getBigUint64(138, true).toString(),
    remainingRawInventory: view.getBigUint64(146, true).toString(),
    status: data[212] === 1 ? 'active' : 'unknown',
    currentStageIndex: view.getUint16(178, true),
    currentCommitmentFingerprint: `${toHex(commitment.slice(0, 6))}…${toHex(commitment.slice(-4))}`,
    createdAt: new Date(Number(view.getBigInt64(213, true)) * 1_000).toLocaleString(),
    expiresAt: new Date(Number(view.getBigInt64(221, true)) * 1_000).toLocaleString(),
  };
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
