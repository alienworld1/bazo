'use client';

import type { MarketSession } from '@/lib/markets';
import type {
  EncryptedPlanPayloadV1,
  PrivatePlanPackageV1,
} from '@bazo/plan-crypto';

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

type PrivatePlanMaterial = PrivatePlanPreview & {
  package: PrivatePlanPackageV1;
  payload?: EncryptedPlanPayloadV1;
  planKey?: Uint8Array;
};

const previews = new Map<string, PrivatePlanMaterial>();
const listeners = new Set<() => void>();
let revision = 0;

export function rememberPrivatePlan(
  plan: string,
  preview: PrivatePlanMaterial,
) {
  previews.set(plan, preview);
  notify();
}

export function rememberVerifiedPrivatePlan(
  privatePackage: PrivatePlanPackageV1,
  payload: EncryptedPlanPayloadV1,
  planKey: Uint8Array,
) {
  rememberPrivatePlan(privatePackage.plan, {
    owner: privatePackage.owner,
    package: privatePackage,
    payload,
    planKey,
    stages: privatePackage.stages.map(stage => ({
      index: stage.stageIndex,
      rawQuantity: stage.rawQuantity.toString(),
      minPremiumBps: stage.minPremiumBps,
      allowedSessions: sessions(stage.allowedSessionMask),
    })),
  });
}

export function getPrivatePlanPreview(plan: string, owner: string) {
  const preview = previews.get(plan);
  return preview?.owner === owner ? preview : undefined;
}

export function getPrivatePlanPackage(plan: string, owner: string) {
  return previews.get(plan)?.owner === owner
    ? previews.get(plan)?.package
    : undefined;
}

export function getPrivatePlanRecoveryMaterial(plan: string, owner: string) {
  const material = previews.get(plan);
  return material?.owner === owner && material.payload && material.planKey
    ? { payload: material.payload, planKey: material.planKey }
    : undefined;
}

export function clearPrivatePlansExcept(owner?: string) {
  let changed = false;
  for (const [plan, material] of previews) {
    if (material.owner !== owner) {
      previews.delete(plan);
      changed = true;
    }
  }
  if (changed) notify();
}

export function subscribeToPrivatePlans(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPrivatePlanRevision() {
  return revision;
}

function notify() {
  revision += 1;
  for (const listener of listeners) listener();
}

function sessions(mask: number): readonly MarketSession[] {
  return (['regular', 'preMarket', 'postMarket', 'overNight'] as const).filter(
    (_, index) => Boolean(mask & (1 << index)),
  );
}
