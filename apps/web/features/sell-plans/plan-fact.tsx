export function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line-subtle pb-3">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="break-all font-mono text-text-primary">{value}</dd>
    </div>
  );
}
