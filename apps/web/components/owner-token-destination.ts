import { address, type Instruction } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token-2022';
import { solanaClient } from './solana-client';

export async function ownerTokenDestination(input: {
  owner: string;
  mint: string;
  tokenProgram: string;
}): Promise<{ address: string; createInstruction: Instruction }> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(input.owner),
    mint: address(input.mint),
    tokenProgram: address(input.tokenProgram),
  });
  return {
    address: ata,
    createInstruction: getCreateAssociatedTokenIdempotentInstruction({
      payer: solanaClient.payer,
      ata,
      owner: address(input.owner),
      mint: address(input.mint),
      tokenProgram: address(input.tokenProgram),
    }),
  };
}
