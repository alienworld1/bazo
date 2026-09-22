import type { ReactNode } from 'react';

export function BuyRequestField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm text-text-primary">
      {label}
      {children}
    </label>
  );
}
