type WalletIdentity = {
  features: readonly string[];
  name: string;
  version: string;
};

const compatibleWallets = new Set(['Phantom@1.0.0']);

export function supportsAutomaticPrivateRecovery(wallet: WalletIdentity) {
  return (
    wallet.features.includes('solana:signMessage') &&
    compatibleWallets.has(`${wallet.name}@${wallet.version}`)
  );
}
