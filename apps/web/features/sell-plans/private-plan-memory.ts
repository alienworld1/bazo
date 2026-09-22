'use client';

import type { MarketSession } from '@/lib/markets';
import type { PrivatePlanPackageV1 } from '@bazo/plan-crypto';
import type { EncryptedPlanPayloadV1 } from '@bazo/plan-crypto';

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

type PrivatePlanMaterial = PrivatePlanPreview & { package: PrivatePlanPackageV1; payload?: EncryptedPlanPayloadV1; planKey?: Uint8Array };

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

export function getPrivatePlanRecoveryMaterial(plan: string, owner: string) {
  const material = previews.get(plan);
  return material?.owner === owner && material.payload && material.planKey
    ? { payload: material.payload, planKey: material.planKey }
    : undefined;
}

export function clearPrivatePlansExcept(owner?: string) {
  for (const [plan, material] of previews) {
    if (material.owner !== owner) previews.delete(plan);
  }
}
