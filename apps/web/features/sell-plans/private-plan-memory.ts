'use client';

import type { MarketSession } from '@/lib/markets';

export type PrivateStagePreview = {
  index: number;
  rawQuantity: string;
  minPremiumBps: number;
  allowedSessions: readonly MarketSession[];
};

type PrivatePlanPreview = {
  owner: string;
  stages: readonly PrivateStagePreview[];
};

const previews = new Map<string, PrivatePlanPreview>();

export function rememberPrivatePlan(
  plan: string,
  preview: PrivatePlanPreview,
) {
  previews.set(plan, preview);
}

export function getPrivatePlanPreview(plan: string, owner: string) {
  const preview = previews.get(plan);
  return preview?.owner === owner ? preview : undefined;
}
