import { serializeOpening, type BuyRequestOpeningV1 } from '@bazo/sdk';
import { authenticatePrivateStorage } from '@/features/sell-plans/recovery/private-storage-client';

export async function deliverBuyRequestOpening(
  opening: BuyRequestOpeningV1,
): Promise<void> {
  await authenticatePrivateStorage(opening.buyer);
  const response = await fetch(`/api/buy-requests/${opening.request}/opening`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(serializeOpening(opening)),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('delivery failed');
}
