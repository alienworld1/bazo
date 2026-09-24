import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from '@solana/kit';
import { solanaClient } from '@/components/solana-client';

export async function simulateWalletTransaction(
  instructions: readonly Instruction[],
): Promise<void> {
  const { value: blockhash } = await solanaClient.rpc
    .getLatestBlockhash({ commitment: 'confirmed' })
    .send();
  const message = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      blockhash,
      setTransactionMessageFeePayer(
        solanaClient.payer.address,
        createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  const result = await solanaClient.rpc
    .simulateTransaction(
      getBase64EncodedWireTransaction(compileTransaction(message)),
      { encoding: 'base64', sigVerify: false, commitment: 'confirmed' },
    )
    .send();
  if (result.value.err) throw new Error('request simulation failed');
}
