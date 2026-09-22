'use client';

import type { MarketSession } from '@/lib/markets';
import type { PrivatePlanPackageV1 } from '@bazo/plan-crypto';

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

type PrivatePlanMaterial = PrivatePlanPreview & { package: PrivatePlanPackageV1 };

const previews = new Map<string, PrivatePlanMaterial>();

export function rememberPrivatePlan(
  plan: string,
  preview: PrivatePlanMaterial,
) {
  previews.set(plan, preview);
}

export function getPrivatePlanPreview(plan: string, owner: string) {
  const preview = previews.get(plan);
  return preview?.owner === owner ? preview : undefined;
}

export function getPrivatePlanPackage(plan: string, owner: string) {
  return previews.get(plan)?.owner === owner ? previews.get(plan)?.package : undefined;
}

export function clearPrivatePlansExcept(owner?: string) {
  for (const [plan, material] of previews) {
    if (material.owner !== owner) previews.delete(plan);
  }
}
