import { AppShell } from '@/components/app-shell';

export default function ActivityPage() {
  return (
    <AppShell>
      <section className="mx-auto max-w-5xl py-16">
        <p className="font-mono text-xs text-text-tertiary">ACTIVITY</p>
        <h1 className="mt-4 text-3xl font-medium text-text-primary">
          No activity yet.
        </h1>
        <p className="mt-3 text-text-secondary">
          Your Bazo activity will appear here.
        </p>
      </section>
    </AppShell>
  );
}
