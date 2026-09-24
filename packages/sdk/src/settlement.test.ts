import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { settlementInstructions } from './settlement';

const key = (value: number) =>
  address(getBase58Decoder().decode(new Uint8Array(32).fill(value)));

describe('sale transaction', () => {
  it.each([2, 4])(
    'fits a %i-buyer sale and binds its signed bytes',
    async buyerCount => {
      const signedReference = new Uint8Array(159);
      const signedView = new DataView(signedReference.buffer);
      signedView.setUint32(0, 2_182_742_457, true);
      signedView.setUint16(100, 57, true);
      const pair = await settlementInstructions({
        programAddress: key(1),
        caller: key(2),
        market: key(3),
        plan: key(4),
        batch: key(5),
        stockMint: key(6),
        quoteMint: key(7),
        stockVault: key(8),
        proceedsVault: key(9),
        stockTokenProgram: key(10),
        quoteTokenProgram: key(11),
        pythProgram: key(12),
        pythStorage: key(13),
        pythTreasury: key(14),
        stageIndex: 0,
        stage: {
          rawQuantity: BigInt(buyerCount),
          minPremiumBps: 100,
          allowedSessionMask: 1,
          maxReferenceAgeSeconds: 90,
          nextCommitment: new Uint8Array(32).fill(1),
          salt: new Uint8Array(32).fill(2),
        },
        requests: Array.from(
          { length: buyerCount },
          (_, index) => index + 1,
        ).map(value => ({
          request: key(20 + value),
          escrow: key(30 + value),
          recipientStockAccount: key(40 + value),
          targetRawQuantity: 1n,
          maxPremiumBps: 200,
          allowPartialFills: true,
          salt: new Uint8Array(32).fill(value),
        })),
        signedReference,
      });
      const offsets = new DataView(pair.ed25519Instruction.data!.buffer);
      const start =
        pair.settlementInstruction.data!.length - signedReference.length;
      expect(offsets.getUint16(2, true)).toBe(start + 4);
      expect(offsets.getUint16(6, true)).toBe(start + 68);
      expect(offsets.getUint16(10, true)).toBe(start + 102);
      expect(offsets.getUint16(12, true)).toBe(57);
      const message = appendTransactionMessageInstructions(
        [pair.ed25519Instruction, pair.settlementInstruction],
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: key(27), lastValidBlockHeight: 1n },
          setTransactionMessageFeePayer(
            key(2),
            createTransactionMessage({ version: 1 }),
          ),
        ),
      );
      const size = Buffer.from(
        getBase64EncodedWireTransaction(compileTransaction(message)),
        'base64',
      ).length;
      expect(size).toBeLessThanOrEqual(4096);
    },
  );
});
