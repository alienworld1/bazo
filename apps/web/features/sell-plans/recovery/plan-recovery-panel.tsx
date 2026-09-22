'use client';

import Link from 'next/link';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { solanaClient } from '@/components/solana-client';
import { getPrivatePlanPackage, getPrivatePlanRecoveryMaterial } from '../private-plan-memory';
import { BackupSellPlanDialog } from './backup-sell-plan-dialog';
import { useState } from 'react';

export function PlanRecoveryPanel({ plan, owner }: { plan: string; owner: string }) {
  const connected = useConnectedWallet(solanaClient);
  const [dialog, setDialog] = useState(false);
  const privatePackage = connected?.account.address === owner ? getPrivatePlanPackage(plan, owner) : undefined;
  const recoveryMaterial = connected?.account.address === owner ? getPrivatePlanRecoveryMaterial(plan, owner) : undefined;
  if (connected?.account.address !== owner) return null;
  return <section className="mt-6 border-t border-line-default pt-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-text-primary">Recovery not set up</p><p className="mt-1 text-sm text-text-secondary">Automatic private recovery isn’t available with this wallet. Download an encrypted backup to protect this Plan.</p></div><div className="flex flex-col gap-2 sm:items-end"><button type="button" disabled className="min-h-11 border border-line-default px-4 text-sm text-text-disabled">Save private copy</button>{privatePackage && recoveryMaterial ? <button type="button" onClick={() => setDialog(true)} className="min-h-11 shrink-0 border border-line-strong bg-surface-3 px-4 text-sm text-text-primary">Backup Sell Plan</button> : <Link href="/settings/security" className="min-h-11 text-sm text-text-primary underline">Restore backup</Link>}</div></div>{!privatePackage ? <p className="mt-4 text-sm text-text-secondary">Private Plan details aren’t available here yet. <Link href="/settings/security" className="underline">Restore an encrypted backup to continue this sealed path.</Link></p> : null}{dialog && privatePackage && recoveryMaterial ? <BackupSellPlanDialog package={privatePackage} payload={recoveryMaterial.payload} planKey={recoveryMaterial.planKey} onClose={() => setDialog(false)} /> : null}</section>;
}
