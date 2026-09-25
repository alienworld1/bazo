import { AppShell } from '@/components/app-shell';
import { WalletActivity } from '@/features/portfolio/wallet-activity';

export default function ActivityPage() {
  return (
    <AppShell>
      <section className="mx-auto max-w-5xl py-8">
        <p className="font-mono text-xs text-text-tertiary">ACTIVITY</p>
        <h1 className="mt-4 text-3xl font-medium text-text-primary">
          Your activity
        </h1>
        <WalletActivity />
      </section>
    </AppShell>
  );
}
