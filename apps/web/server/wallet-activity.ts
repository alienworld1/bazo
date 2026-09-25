import 'server-only';

import { readSalesForPlan } from './settlements';
import { readWalletPositions } from './wallet-positions';
import { readRecoveryActivity } from './recovery-activity';

export type WalletActivity = {
  id: string;
  title: string;
  detail: string;
  href: string;
  occurredAtUnix: string | null;
  signature: string | null;
};

export async function readWalletActivity(owner: string) {
  const positions = await readWalletPositions(owner);
  const saleResults: Array<Awaited<
    ReturnType<typeof readSalesForPlan>
  > | null> = [];
  for (const plan of positions.plans) {
    try {
      const sales =
        plan.currentStageIndex > 0 ? await readSalesForPlan(plan) : [];
      saleResults.push(sales);
    } catch {
      saleResults.push(null);
    }
  }
  const items: WalletActivity[] = [
    ...positions.plans.map(plan => ({
      id: `plan:${plan.address}`,
      title: 'Sell Plan funded',
      detail: `${plan.initialRawInventory} raw stock units committed`,
      href: `/sell-plans/${plan.address}`,
      occurredAtUnix: plan.createdAtUnix,
      signature: null,
    })),
    ...positions.requests.map(request => ({
      id: `request:${request.address}`,
      title: 'Buy Request funded',
      detail: `${request.maxQuoteAmount} raw quote units committed`,
      href: `/buy-requests/${request.address}`,
      occurredAtUnix: request.createdAt,
      signature: null,
    })),
  ];
  let partial = positions.partial;
  saleResults.forEach((result, index) => {
    if (!result) {
      partial = true;
      return;
    }
    for (const entry of result) {
      if (!entry.sale) {
        partial = true;
        continue;
      }
      const { receipt, signature, occurredAtUnix } = entry.sale;
      items.push({
        id: `sale:${receipt.address}`,
        title: `Stage ${receipt.stageIndex + 1} sold`,
        detail: `${receipt.rawStockQuantity} raw stock units for ${receipt.rawQuoteQuantity} raw quote units`,
        href: `/sell-plans/${positions.plans[index].address}#sale-${receipt.stageIndex}`,
        occurredAtUnix: occurredAtUnix ?? null,
        signature,
      });
    }
  });
  const subjects = [
    ...positions.plans.map(plan => ({
      address: plan.address,
      kind: 'plan' as const,
      createdAt: plan.createdAtUnix,
    })),
    ...positions.requests.map(request => ({
      address: request.address,
      kind: 'request' as const,
      createdAt: request.createdAt,
    })),
  ].sort((left, right) => {
    const leftTime = BigInt(left.createdAt);
    const rightTime = BigInt(right.createdAt);
    return leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1;
  });
  if (subjects.length > 8) partial = true;
  const recentSubjects = subjects.slice(0, 8);
  for (let index = 0; index < recentSubjects.length; index += 3) {
    const results = await Promise.allSettled(
      recentSubjects.slice(index, index + 3).map(subject =>
        readRecoveryActivity(subject.address, owner, subject.kind),
      ),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        partial = true;
        continue;
      }
      items.push(...result.value.items);
      if (result.value.partial) partial = true;
    }
  }
  items.sort((left, right) => {
    const first = BigInt(left.occurredAtUnix ?? '0');
    const second = BigInt(right.occurredAtUnix ?? '0');
    return first === second
      ? left.id.localeCompare(right.id)
      : first > second
        ? -1
        : 1;
  });
  return { items: items.slice(0, 50), partial: partial || items.length > 50 };
}
