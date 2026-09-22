import type { MarketConfig, MarketSession, SupportedHolding } from '@/lib/markets';
import type { PrivatePlanPackageV1 } from '@bazo/plan-crypto';
import type { EncryptedPlanPayloadV1 } from '@bazo/plan-crypto';

export type SellPlanMarket = Pick<
  MarketConfig,
  | 'id'
  | 'symbol'
  | 'network'
  | 'stockMint'
  | 'stockTokenProgram'
  | 'quoteMint'
  | 'quoteTokenProgram'
  | 'quoteSymbol'
  | 'tokenDecimals'
  | 'minimumStageRawAmount'
  | 'maxReferenceAgeSeconds'
  | 'allowedSessions'
>;

export type DraftStage = {
  id: string;
  allocationBps: number;
  minPremiumBps: number;
  allowedSessions: MarketSession[];
};

export type PreparedSellPlan = {
  marketAddress: string;
  planNonce: string;
  plan: string;
  stockVault: string;
  proceedsVault: string;
  headCommitment: string;
  rawAmount: string;
  displayAmount: string;
  expiresAt: string;
  expiresAtUnix: string;
  headCommitmentBytes: Uint8Array;
  privatePackage: PrivatePlanPackageV1;
  privatePayload: EncryptedPlanPayloadV1;
  privatePlanKey: Uint8Array;
};

export type LoadedHolding = SupportedHolding;
