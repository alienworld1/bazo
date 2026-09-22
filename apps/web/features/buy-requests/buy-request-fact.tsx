export function BuyRequestFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="border-b border-line-subtle pb-3">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="mt-1 break-all font-mono text-text-primary">{value}</dd>
    </div>
  );
}
