'use client';

import { useRouter } from 'next/navigation';

export function RefreshSaleStatus() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="min-h-11 border border-line-default px-4 text-sm text-text-primary"
    >
      Refresh status
    </button>
  );
}
