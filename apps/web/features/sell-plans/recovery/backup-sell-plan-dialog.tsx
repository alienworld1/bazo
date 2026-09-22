'use client';

import { useRef, useState } from 'react';
import { createBackup, encryptPlanPackage, serializeBackup, type PrivatePlanPackageV1 } from '@bazo/plan-crypto';

export function BackupSellPlanDialog({ package: privatePackage, onClose }: { package: PrivatePlanPackageV1; onClose: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const valid = [...passphrase.normalize('NFKC')].length >= 12 && passphrase === confirmation;
  const create = async () => {
    if (!valid) { setError(passphrase !== confirmation ? 'The passphrases don’t match.' : 'Use a longer recovery passphrase.'); return; }
    try {
      const { planKey, payload } = await encryptPlanPackage(privatePackage);
      const backup = await createBackup(payload, planKey, passphrase);
      const blob = new Blob([serializeBackup(backup)], { type: 'application/vnd.bazo.private-plan+json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${privatePackage.plan.slice(0, 8)}.bazo`;
      link.click();
      URL.revokeObjectURL(link.href);
      setPassphrase(''); setConfirmation(''); setComplete(true); button.current?.focus();
    } catch { setError('We couldn’t create this encrypted backup. Try again.'); }
  };
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-canvas/90 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="backup-title" className="w-full max-w-md rounded-[14px] border border-line-default bg-surface-2 p-6 shadow-2xl"><h2 id="backup-title" className="text-xl font-medium text-text-primary">Backup Sell Plan</h2>{complete ? <div className="mt-4" aria-live="polite"><p className="text-sm text-text-primary">Encrypted backup downloaded</p><p className="mt-2 text-sm text-text-secondary">Keep the file and recovery passphrase separately. Bazo can’t recover the passphrase.</p><button ref={button} type="button" onClick={onClose} className="mt-6 min-h-11 border border-line-default px-4 text-sm text-text-primary">Done</button></div> : <><p className="mt-3 text-sm text-text-secondary">Use a recovery passphrase you can keep separately from this file. Bazo can’t recover it.</p><label className="mt-6 block text-sm text-text-secondary" htmlFor="backup-passphrase">Recovery passphrase</label><input id="backup-passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} className="mt-2 min-h-10 w-full border border-line-default bg-surface-1 px-3 text-text-primary" /><label className="mt-4 block text-sm text-text-secondary" htmlFor="backup-confirmation">Confirm recovery passphrase</label><input id="backup-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 min-h-10 w-full border border-line-default bg-surface-1 px-3 text-text-primary" />{error ? <p className="mt-3 text-sm text-warning" role="alert">{error}</p> : null}<div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={() => void create()} disabled={!valid} className="min-h-11 bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled">Create encrypted backup</button><button type="button" onClick={onClose} className="min-h-11 border border-line-default px-4 text-sm text-text-primary">Close</button></div></>}</section></div>;
}
