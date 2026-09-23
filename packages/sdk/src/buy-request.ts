import { getBase58Decoder } from '@solana/kit';

const discriminator = Uint8Array.of(175, 29, 113, 183, 180, 108, 205, 201);
const decoder = getBase58Decoder();
export const BUY_REQUEST_ACCOUNT_DATA_LENGTH = 269;

export type PublicBuyRequest = {
  address: string;
  buyer: string;
  recipient: string;
  market: string;
  escrow: string;
  maxQuoteAmount: string;
  spentQuoteAmount: string;
  refundableQuoteAmount: string;
  filledRawQuantity: string;
  expiresAt: string;
  createdAt: string;
  createdSlot: string;
  requestNonce: string;
  status: 'active' | 'canceled' | 'expired' | 'unknown';
  lockedBatch: string | null;
  commitmentFingerprint: string;
  commitmentHex: string;
};

export function decodePublicBuyRequest(
  data: Uint8Array,
  requestAddress: string,
): PublicBuyRequest | null {
  if (
    data.length !== BUY_REQUEST_ACCOUNT_DATA_LENGTH ||
    !same(data.slice(0, 8), discriminator) ||
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(
      8,
      true,
    ) !== 1
  )
    return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lockTag = data[234];
  if (lockTag !== 0 && lockTag !== 1) return null;
  const commitment = data.slice(138, 170);
  const statusOffset = lockTag === 1 ? 267 : 235;
  return {
    address: requestAddress,
    buyer: decoder.decode(data.slice(10, 42)),
    recipient: decoder.decode(data.slice(42, 74)),
    market: decoder.decode(data.slice(74, 106)),
    escrow: decoder.decode(data.slice(106, 138)),
    maxQuoteAmount: view.getBigUint64(170, true).toString(),
    spentQuoteAmount: view.getBigUint64(178, true).toString(),
    refundableQuoteAmount: view.getBigUint64(186, true).toString(),
    filledRawQuantity: view.getBigUint64(194, true).toString(),
    expiresAt: view.getBigInt64(202, true).toString(),
    createdAt: view.getBigInt64(210, true).toString(),
    createdSlot: view.getBigUint64(218, true).toString(),
    requestNonce: view.getBigUint64(226, true).toString(),
    status:
      data[statusOffset] === 1
        ? 'active'
        : data[statusOffset] === 2
          ? 'canceled'
          : data[statusOffset] === 3
            ? 'expired'
            : 'unknown',
    lockedBatch: lockTag === 1 ? decoder.decode(data.slice(235, 267)) : null,
    commitmentFingerprint: `${hex(commitment.slice(0, 6))}…${hex(commitment.slice(-4))}`,
    commitmentHex: hex(commitment),
  };
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(
    '',
  );
}
