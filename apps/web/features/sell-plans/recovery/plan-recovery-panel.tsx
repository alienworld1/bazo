'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { BackupSellPlanDialog } from './backup-sell-plan-dialog';
import { usePlanRecovery } from './use-plan-recovery';

export function PlanRecoveryPanel({
  plan,
  owner,
}: {
  plan: string;
  owner: string;
}) {
  const recovery = usePlanRecovery(plan, owner);
  const [dialog, setDialog] = useState(false);
  const backupButton = useRef<HTMLButtonElement>(null);

  if (!recovery.isOwner) return null;

  const [title, detail] = recovery.statusCopy;
  return (
    <section
      className="mt-6 border-t border-line-default pt-5"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-h-16">
          <p className="text-sm font-medium text-text-primary">{title}</p>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">{detail}</p>
          {recovery.error ? (
            <p className="mt-2 text-sm text-warning" role="alert">
              {recovery.error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <button
            type="button"
            disabled={
              !recovery.canSave || recovery.busy || recovery.status === 'saved'
            }
            onClick={() => void recovery.save()}
            className="min-h-11 rounded border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
          >
            {recovery.status === 'saving'
              ? 'Saving private copy…'
              : 'Save private copy'}
          </button>
          {recovery.hasMaterial ? (
            <button
              ref={backupButton}
              type="button"
              disabled={recovery.busy}
              onClick={() => setDialog(true)}
              className="min-h-11 shrink-0 rounded border border-line-strong bg-surface-3 px-4 text-sm text-text-primary disabled:text-text-disabled"
            >
              Backup Sell Plan
            </button>
          ) : (
            <Link
              href="/settings/security"
              className="min-h-11 py-3 text-sm text-text-primary underline"
            >
              Restore backup
            </Link>
          )}
        </div>
      </div>
      {!recovery.privatePackage && recovery.status === 'idle' ? (
        <p className="mt-4 text-sm text-text-secondary">
          We can&apos;t continue this sealed Plan without its private details.
          Restore your backup, or cancel the remaining Plan when matching is no
          longer locked. Your stock and proceeds remain under the onchain Plan.{' '}
          <Link href="/settings/security" className="underline">
            Restore backup
          </Link>
        </p>
      ) : null}
      {dialog && recovery.privatePackage && recovery.recoveryMaterial ? (
        <BackupSellPlanDialog
          package={recovery.privatePackage}
          payload={recovery.recoveryMaterial.payload}
          planKey={recovery.recoveryMaterial.planKey}
          onClose={() => {
            setDialog(false);
            window.requestAnimationFrame(() => backupButton.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
}
