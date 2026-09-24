import { createHash } from 'node:crypto';
import {
  address,
  createSolanaRpc,
  getBase58Decoder,
  parseBase64RpcAccount,
} from '@solana/kit';

export const PYTH_VERIFIER_PROGRAM = address(
  'pytd2yyk641x7ak7mkaasSJVXh6YYZnC7wTmtgAyxPt',
);
export const PYTH_VERIFIER_STORAGE = address(
  '3rdJbqfnagQ4yx9HXJViD4zc4xpiSqmFsKpPuSCQVyQL',
);

const storageDiscriminator = createHash('sha256')
  .update('account:Storage')
  .digest()
  .subarray(0, 8);
const decoder = getBase58Decoder();

export async function readPythVerifierTreasury(rpcUrl: string) {
  const rpc = createSolanaRpc(rpcUrl);
  const account = parseBase64RpcAccount(
    PYTH_VERIFIER_STORAGE,
    (
      await rpc
        .getAccountInfo(PYTH_VERIFIER_STORAGE, {
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send()
    ).value,
  );
  if (
    !account.exists ||
    account.programAddress !== PYTH_VERIFIER_PROGRAM ||
    account.data.length !== 381 ||
    !storageDiscriminator.every((value, index) => account.data[index] === value)
  )
    throw new Error('Pyth verifier storage unavailable');
  return address(decoder.decode(account.data.slice(40, 72)));
}
