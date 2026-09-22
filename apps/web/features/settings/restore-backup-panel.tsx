'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { parseBackup, unlockBackup, verifyRestoredPackage } from '@bazo/plan-crypto';
import { solanaClient } from '@/components/solana-client';
import { rememberPrivatePlan } from '@/features/sell-plans/private-plan-memory';

export function RestoreBackupPanel() {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [backupText, setBackupText] = useState<string>();
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const choose = async (file?: File) => {
    setError(undefined); setStatus(undefined); setPassphrase('');
    if (!file || !file.name.endsWith('.bazo') || file.size === 0 || file.size > 256 * 1024) { setBackupText(undefined); setError('Choose a valid Bazo backup file.'); return; }
    try { parseBackup(await file.text()); setBackupText(await file.text()); } catch { setBackupText(undefined); setError('Choose a valid Bazo backup file.'); }
  };
  const restore = async () => {
    if (!backupText || !connected) return;
    setError(undefined); setStatus('Decrypting on this device…');
    try {
      const backup = parseBackup(backupText);
      if (backup.payload.owner !== connected.account.address) throw new Error('owner');
      const { package: privatePackage } = await unlockBackup(backup, passphrase);
      setStatus('Verifying with Solana…');
      const response = await fetch(`/api/sell-plans/${privatePackage.plan}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('chain');
      const state = await response.json();
      await verifyRestoredPackage(privatePackage, state);
      rememberPrivatePlan(privatePackage.plan, { owner: privatePackage.owner, package: privatePackage, stages: privatePackage.stages.map(stage => ({ index: stage.stageIndex, rawQuantity: stage.rawQuantity.toString(), minPremiumBps: stage.minPremiumBps, allowedSessions: sessions(stage.allowedSessionMask) })) });
      setPassphrase(''); setBackupText(undefined); setStatus('Backup restored and verified');
      router.push(`/sell-plans/${privatePackage.plan}?recovery=restored`);
    } catch (cause) {
      setStatus(undefined);
      const message = cause instanceof Error ? cause.message : '';
      setError(message === 'owner' ? 'Reconnect the wallet that owns this Sell Plan.' : message.includes('decryption') ? 'That passphrase couldn’t unlock this backup.' : message.includes('commitment') || message.includes('inventory') ? 'These private details don’t match the current onchain Plan. Nothing was restored.' : 'We couldn’t verify this backup with Solana. Nothing was restored.');
    }
  };
  return <section className="mx-auto max-w-xl border-y border-line-default py-8"><p className="font-mono text-xs text-text-tertiary">SECURITY</p><h1 className="mt-3 text-3xl font-medium text-text-primary">Restore backup</h1><p className="mt-3 text-text-secondary">Restore the private details for a Sell Plan from an encrypted Bazo backup.</p><label className="mt-8 block text-sm text-text-secondary" htmlFor="backup-file">Encrypted backup file</label><input id="backup-file" type="file" accept=".bazo,application/json" onChange={event => void choose(event.target.files?.[0])} className="mt-2 block min-h-11 w-full text-sm text-text-secondary" />{backupText ? <><label className="mt-6 block text-sm text-text-secondary" htmlFor="restore-passphrase">Recovery passphrase</label><input id="restore-passphrase" type="password" value={passphrase} onChange={event => setPassphrase(event.target.value)} className="mt-2 min-h-10 w-full border border-line-default bg-surface-1 px-3 text-text-primary" /><p className="mt-2 text-sm text-text-secondary">Connect the wallet that owns this Sell Plan to restore private details.</p><button type="button" disabled={!connected || !passphrase || Boolean(status)} onClick={() => void restore()} className="mt-6 min-h-11 bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled">Restore and verify</button><button type="button" onClick={() => { setBackupText(undefined); setPassphrase(''); setError(undefined); }} className="ml-3 min-h-11 text-sm text-text-primary underline">Choose another file</button></> : null}{status ? <p className="mt-5 text-sm text-text-secondary" aria-live="polite">{status}</p> : null}{error ? <p className="mt-5 text-sm text-warning" role="alert">{error}</p> : null}<section className="mt-10 border-t border-line-default pt-5"><h2 className="text-lg font-medium text-text-primary">Private Plan details unavailable</h2><p className="mt-2 text-sm text-text-secondary">Bazo can’t continue this sealed path without its private Plan details. Your funds remain controlled by the onchain Plan. Restore a backup or cancel the remaining Plan when it becomes available.</p></section></section>;
}

function sessions(mask: number) { return (['regular', 'preMarket', 'postMarket', 'overNight'] as const).filter((_, index) => Boolean(mask & (1 << index))); }
