import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  address,
  createSolanaRpc,
  parseBase64RpcAccount,
  type Address,
  type Instruction,
} from '@solana/kit';
import { decodeToken } from '@solana-program/token-2022';
import { findAssociatedTokenPda } from '@solana-program/token-2022';
import {
  hashCanonicalStage,
  toHex,
  type CanonicalStageV1,
} from '@bazo/plan-crypto';
import {
  buildMatchProposal,
  deriveMarketAddress,
  fetchBatch,
  fetchBuyRequest,
  fetchBatchOutcome,
  fetchPlanReservation,
  fetchSettlementPolicy,
  hashBuyRequestOpening,
  parseBuyOpening,
  parseStageOpening,
  reservePlanInstruction,
  releasePlanReservationInstruction,
  settlementInstructions,
  type BuyRequestOpeningV1,
  type MatchBuyer,
  type MatchSeller,
  type MatchProposal,
  type PublicBatch,
} from '@bazo/sdk';
import { decodePublicSellPlan } from '../../../apps/web/lib/plan-projection';
import { startCrank } from './crank';
import { readSignedReference } from './signed-reference';

const rpcUrl = required('SOLANA_RPC_URL');
const programAddress = address(required('BAZO_PROGRAM_ID'));
const secret = required('BAZO_COORDINATOR_SECRET');
if (secret.length < 32) throw new Error('coordinator secret is too short');
const rpc = createSolanaRpc(rpcUrl);
const port = Number(process.env.BAZO_COORDINATOR_PORT ?? '3145');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('invalid coordinator port');

const requests = new Map<
  string,
  { opening: BuyRequestOpeningV1; fingerprint: string; deliveredAt: bigint }
>();
const plans = new Map<
  string,
  { opening: CanonicalStageV1; fingerprint: string }
>();
const proposals = new Map<string, MatchProposal>();
const expectedMarket = deriveMarketAddress(programAddress, {
  stockMint: address(required('BAZO_STOCK_MINT')),
  quoteMint: address(required('BAZO_QUOTE_MINT')),
});
const webBaseUrl = new URL(
  process.env.BAZO_WEB_BASE_URL ?? 'http://127.0.0.1:3000/',
);
if (
  webBaseUrl.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(webBaseUrl.hostname)
)
  throw new Error('invalid web reference endpoint');

await startCrank({
  rpcUrl,
  programAddress,
  stockMint: address(required('BAZO_STOCK_MINT')),
  quoteMint: address(required('BAZO_QUOTE_MINT')),
  requests,
  readChainTime,
  verifyRequest,
  settleLockedBatch,
});
createServer((request, response) => {
  void handle(request, response);
}).listen(port, '127.0.0.1');

async function handle(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!authorized(request.headers['x-bazo-coordinator-secret']))
    return reply(response, 401, { code: 'unauthorized' });
  try {
    if (request.method === 'POST' && request.url === '/v1/openings/request') {
      const opening = parseBuyOpening(await readBody(request));
      const fingerprint = await verifyDeliveredRequest(opening);
      const previous = requests.get(opening.request);
      if (previous && previous.fingerprint !== fingerprint)
        return reply(response, 409, { code: 'conflict' });
      requests.set(opening.request, {
        opening,
        fingerprint,
        deliveredAt: previous?.deliveredAt ?? (await readChainTime()),
      });
      return reply(response, 200, { delivered: true });
    }
    if (request.method === 'POST' && request.url === '/v1/openings/plan') {
      const opening = parseStageOpening(await readBody(request));
      const fingerprint = await verifyPlan(opening);
      const previous = plans.get(opening.plan);
      if (previous && previous.fingerprint !== fingerprint)
        return reply(response, 409, { code: 'conflict' });
      plans.set(opening.plan, { opening, fingerprint });
      return reply(response, 200, { delivered: true });
    }
    const requestOpeningAddress = request.url?.match(
      /^\/v1\/openings\/request\/([1-9A-HJ-NP-Za-km-z]{32,44})$/,
    )?.[1];
    if (request.method === 'GET' && requestOpeningAddress) {
      const stored = requests.get(requestOpeningAddress);
      if (!stored) return reply(response, 200, { delivered: false });
      try {
        await verifyDeliveredRequest(stored.opening);
        return reply(response, 200, { delivered: true });
      } catch {
        requests.delete(requestOpeningAddress);
        return reply(response, 200, { delivered: false });
      }
    }
    const planOpeningAddress = request.url?.match(
      /^\/v1\/openings\/plan\/([1-9A-HJ-NP-Za-km-z]{32,44})$/,
    )?.[1];
    if (request.method === 'GET' && planOpeningAddress) {
      const stored = plans.get(planOpeningAddress);
      if (!stored) return reply(response, 200, { delivered: false });
      try {
        await verifyPlan(stored.opening);
        return reply(response, 200, { delivered: true });
      } catch {
        plans.delete(planOpeningAddress);
        return reply(response, 200, { delivered: false });
      }
    }
    const proposalAddress = request.url?.match(
      /^\/v1\/proposals\/([1-9A-HJ-NP-Za-km-z]{32,44})$/,
    )?.[1];
    if (request.method === 'GET' && proposalAddress) {
      await batchAvailability(proposalAddress);
      return reply(response, 200, {
        proposal: proposals.get(proposalAddress) ?? null,
      });
    }
    const batchAddress = request.url?.match(
      /^\/v1\/batches\/([1-9A-HJ-NP-Za-km-z]{32,44})$/,
    )?.[1];
    if (request.method === 'GET' && batchAddress)
      return reply(response, 200, await batchAvailability(batchAddress));
    return reply(response, 404, { code: 'not_found' });
  } catch (error) {
    return reply(response, 400, { code: safeIngressError(error) });
  }
}

async function settleLockedBatch(
  batch: PublicBatch,
  caller: Address,
  send: (instructions: Instruction | Instruction[]) => Promise<void>,
): Promise<void> {
  if (
    await fetchBatchOutcome({
      rpcUrl,
      programAddress,
      batch: address(batch.address),
    })
  )
    return;
  await batchAvailability(batch.address);
  const proposal = proposals.get(batch.address);
  if (!proposal) return;
  const storedStage = plans.get(proposal.plan);
  if (!storedStage || storedStage.fingerprint !== proposal.stageFingerprint)
    return;
  const stage = storedStage.opening;
  const now = await readChainTime();
  if (now >= BigInt(batch.lockDeadline)) return;
  await verifyPlan(stage, now);
  const staleReservation = await fetchPlanReservation({
    rpcUrl,
    programAddress,
    plan: address(stage.plan),
    stageIndex: stage.stageIndex,
  });
  if (staleReservation && now >= BigInt(staleReservation.lockDeadline))
    await send(
      await releasePlanReservationInstruction({
        programAddress,
        caller,
        plan: address(stage.plan),
        stageIndex: stage.stageIndex,
      }),
    );
  const policy = await fetchSettlementPolicy({
    rpcUrl,
    programAddress,
    market: address(batch.market),
  });
  if (!policy || policy.reservationAuthority !== caller)
    throw new Error('settlement policy unavailable');
  const market = await readMarketSettlementPolicy(batch.market);
  const reference = await readSignedReference({
    feedId: market.feedId,
    allowedSessionMask: market.allowedSessionMask & stage.allowedSessionMask,
    maximumAgeSeconds: Math.min(
      market.maximumAgeSeconds,
      stage.maxReferenceAgeSeconds,
    ),
    minimumPublisherCount: policy.minimumPublisherCount,
    maximumConfidenceRatioBps: policy.maximumConfidenceRatioBps,
    chainTime: now,
  });
  const settlementRequests = [];
  for (const requestAddress of batch.requests) {
    const stored = requests.get(requestAddress);
    if (
      !stored ||
      (await verifyRequest(stored.opening, batch.address, now)) !==
        stored.fingerprint
    )
      return;
    const request = await fetchBuyRequest({
      rpcUrl,
      programAddress,
      requestAddress,
    });
    if (!request) return;
    const [recipientStockAccount] = await findAssociatedTokenPda({
      owner: stored.opening.recipient,
      mint: address(required('BAZO_STOCK_MINT')),
      tokenProgram: address(required('BAZO_STOCK_TOKEN_PROGRAM')),
    });
    settlementRequests.push({
      request: address(requestAddress),
      escrow: address(request.escrow),
      recipientStockAccount,
      targetRawQuantity: stored.opening.targetRawQuantity,
      maxPremiumBps: stored.opening.maxPremiumBps,
      allowPartialFills: stored.opening.allowPartialFills,
      salt: stored.opening.salt,
    });
  }
  const planAccount = await readAccount(stage.plan);
  const plan =
    planAccount && decodePublicSellPlan(planAccount.data, stage.plan);
  if (
    !plan ||
    plan.currentStageIndex !== stage.stageIndex ||
    plan.status !== 'active'
  )
    return;
  let reservation = await fetchPlanReservation({
    rpcUrl,
    programAddress,
    plan: address(plan.address),
    stageIndex: stage.stageIndex,
  });
  if (!reservation) {
    await send(
      await reservePlanInstruction({
        programAddress,
        caller,
        market: address(batch.market),
        plan: address(plan.address),
        batch: address(batch.address),
        stageIndex: stage.stageIndex,
      }),
    );
    reservation = await fetchPlanReservation({
      rpcUrl,
      programAddress,
      plan: address(plan.address),
      stageIndex: stage.stageIndex,
    });
  }
  if (
    reservation?.batch !== batch.address ||
    reservation.lockDeadline !== batch.lockDeadline
  )
    return;
  const signed = await settlementInstructions({
    programAddress,
    caller,
    market: address(batch.market),
    plan: address(plan.address),
    batch: address(batch.address),
    stockMint: address(required('BAZO_STOCK_MINT')),
    quoteMint: address(required('BAZO_QUOTE_MINT')),
    stockVault: address(plan.stockVault),
    proceedsVault: address(plan.proceedsVault),
    stockTokenProgram: address(required('BAZO_STOCK_TOKEN_PROGRAM')),
    quoteTokenProgram: address(required('BAZO_QUOTE_TOKEN_PROGRAM')),
    pythProgram: address('pytd2yyk641x7ak7mkaasSJVXh6YYZnC7wTmtgAyxPt'),
    pythStorage: address('3rdJbqfnagQ4yx9HXJViD4zc4xpiSqmFsKpPuSCQVyQL'),
    pythTreasury: address('Gx4MBPb1vqZLJajZmsKLg8fGw9ErhoKsR8LeKcCKFyak'),
    stageIndex: stage.stageIndex,
    stage: {
      rawQuantity: stage.rawQuantity,
      minPremiumBps: stage.minPremiumBps,
      allowedSessionMask: stage.allowedSessionMask,
      maxReferenceAgeSeconds: stage.maxReferenceAgeSeconds,
      nextCommitment: stage.nextCommitment,
      salt: stage.salt,
    },
    requests: settlementRequests,
    signedReference: reference.bytes,
  });
  if (
    await fetchBatchOutcome({
      rpcUrl,
      programAddress,
      batch: address(batch.address),
    })
  )
    return;
  await send([signed.ed25519Instruction, signed.settlementInstruction]);
  const outcome = await fetchBatchOutcome({
    rpcUrl,
    programAddress,
    batch: address(batch.address),
  });
  if (!outcome || outcome.receipt !== signed.receipt)
    throw new Error('settlement confirmation uncertain');
  proposals.delete(batch.address);
}

async function readMarketSettlementPolicy(marketAddress: string): Promise<{
  feedId: bigint;
  allowedSessionMask: number;
  maximumAgeSeconds: number;
}> {
  const account = await readAccount(marketAddress);
  if (
    !account ||
    account.programAddress !== programAddress ||
    account.data.length !== 197
  )
    throw new Error('market policy unavailable');
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  const feedId = view.getBigUint64(170, true);
  const allowedSessionMask = account.data[178];
  const maximumAgeSeconds = view.getUint32(179, true);
  if (
    view.getUint16(8, true) !== 1 ||
    account.data[195] !== 1 ||
    feedId.toString() !== required('BAZO_PYTH_FEED_ID') ||
    allowedSessionMask === 0 ||
    maximumAgeSeconds === 0
  )
    throw new Error('market policy mismatch');
  return { feedId, allowedSessionMask, maximumAgeSeconds };
}

async function batchAvailability(batchAddress: string) {
  const batch = await fetchBatch({ rpcUrl, programAddress, batchAddress });
  if (!batch) {
    proposals.delete(batchAddress);
    return { available: false };
  }
  if (batch.market !== (await expectedMarket) || batch.status !== 'locked') {
    proposals.delete(batchAddress);
    return { available: true, status: batch.status };
  }
  const chainTime = await readChainTime();
  if (chainTime >= BigInt(batch.lockDeadline)) {
    proposals.delete(batchAddress);
    return { available: true, status: 'expired' };
  }
  const reference = await readDisplayReference();
  const buyers = await verifiedBuyers(batch, chainTime);
  const sellers = await verifiedSellers(batch, chainTime, reference?.session);
  if (buyers.length !== batch.requests.length || sellers.length === 0) {
    proposals.delete(batchAddress);
    return { available: true, status: 'matching_details_needed' };
  }
  const proposal = await buildMatchProposal({
    batch: address(batch.address),
    lockDeadline: BigInt(batch.lockDeadline),
    chainTime,
    buyers,
    sellers,
  });
  if (proposal) proposals.set(batchAddress, proposal);
  else proposals.delete(batchAddress);
  return {
    available: true,
    status: proposal
      ? reference?.valid &&
        reference.ageSeconds <= matchingReferenceAge(proposal.plan)
        ? 'match_ready'
        : 'candidate_pending_reference'
      : 'matching',
  };
}

function matchingReferenceAge(plan: string): number {
  return plans.get(plan)?.opening.maxReferenceAgeSeconds ?? 0;
}

async function readDisplayReference(): Promise<{
  valid: boolean;
  session?: number;
  ageSeconds: number;
} | null> {
  const marketId = process.env.BAZO_MARKET_ID;
  if (!marketId || !/^[a-z0-9-]+$/.test(marketId)) return null;
  try {
    const response = await fetch(
      new URL(`/api/markets/${marketId}/reference`, webBaseUrl),
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    if (!response.ok) return null;
    const value = (await response.json()) as {
      status?: string;
      marketSession?: string;
      ageSeconds?: number;
    };
    const session = { regular: 1, preMarket: 2, postMarket: 4, overNight: 8 }[
      value.marketSession as
        | 'regular'
        | 'preMarket'
        | 'postMarket'
        | 'overNight'
    ];
    return {
      valid: value.status === 'valid',
      session,
      ageSeconds: Number.isFinite(value.ageSeconds)
        ? value.ageSeconds!
        : Number.POSITIVE_INFINITY,
    };
  } catch {
    return null;
  }
}

async function verifiedBuyers(
  batch: PublicBatch,
  chainTime: bigint,
): Promise<MatchBuyer[]> {
  const result: MatchBuyer[] = [];
  for (const request of batch.requests) {
    const stored = requests.get(request);
    if (!stored) continue;
    try {
      const fingerprint = await verifyRequest(
        stored.opening,
        batch.address,
        chainTime,
      );
      if (fingerprint !== stored.fingerprint) continue;
      const onchain = await fetchBuyRequest({
        rpcUrl,
        programAddress,
        requestAddress: request,
      });
      if (!onchain) continue;
      const remainingRawQuantity =
        stored.opening.targetRawQuantity - BigInt(onchain.filledRawQuantity);
      const remainingQuoteCap =
        BigInt(onchain.maxQuoteAmount) - BigInt(onchain.spentQuoteAmount);
      if (remainingRawQuantity <= 0n || remainingQuoteCap <= 0n) continue;
      result.push({
        request: address(request),
        createdSlot: BigInt(onchain.createdSlot),
        remainingRawQuantity,
        maxPremiumBps: stored.opening.maxPremiumBps,
        allowPartialFills: stored.opening.allowPartialFills,
        remainingQuoteCap,
      });
    } catch {
      continue;
    }
  }
  return result;
}

async function verifiedSellers(
  batch: PublicBatch,
  chainTime: bigint,
  session?: number,
): Promise<MatchSeller[]> {
  const result: MatchSeller[] = [];
  for (const stored of plans.values()) {
    if (stored.opening.market !== batch.market) continue;
    if (session && !(stored.opening.allowedSessionMask & session)) continue;
    try {
      const fingerprint = await verifyPlan(stored.opening, chainTime);
      if (fingerprint !== stored.fingerprint) continue;
      const account = await readAccount(stored.opening.plan);
      if (!account || account.programAddress !== programAddress) continue;
      const plan = decodePublicSellPlan(account.data, stored.opening.plan);
      if (!plan) continue;
      result.push({
        plan: address(plan.address),
        createdAt: BigInt(plan.createdAtUnix),
        stageFingerprint: fingerprint,
        rawQuantity: stored.opening.rawQuantity,
        minPremiumBps: stored.opening.minPremiumBps,
      });
    } catch {
      continue;
    }
  }
  return result;
}

async function verifyRequest(
  opening: BuyRequestOpeningV1,
  lockedBatch?: string,
  chainTime?: bigint,
): Promise<string> {
  const onchain = await fetchBuyRequest({
    rpcUrl,
    programAddress,
    requestAddress: opening.request,
  });
  if (
    !onchain ||
    onchain.status !== 'active' ||
    onchain.buyer !== opening.buyer ||
    onchain.recipient !== opening.recipient ||
    onchain.market !== opening.market ||
    onchain.market !== (await expectedMarket) ||
    onchain.maxQuoteAmount !== opening.maxQuoteAmount.toString() ||
    onchain.expiresAt !== opening.expiresAt.toString() ||
    onchain.requestNonce !== opening.requestNonce.toString() ||
    onchain.lockedBatch !== (lockedBatch ?? null)
  )
    throw new Error('request mismatch');
  const now = chainTime ?? (await readChainTime());
  if (BigInt(onchain.expiresAt) <= now) throw new Error('request expired');
  const fingerprint = toHex(await hashBuyRequestOpening(opening));
  if (fingerprint !== onchain.commitmentHex)
    throw new Error('request commitment mismatch');
  const escrow = await readAccount(onchain.escrow);
  if (!escrow) throw new Error('escrow unavailable');
  const token = decodeToken(escrow);
  if (
    token.data.owner !== address(opening.request) ||
    token.data.mint !== address(required('BAZO_QUOTE_MINT')) ||
    token.programAddress !== address(required('BAZO_QUOTE_TOKEN_PROGRAM')) ||
    token.data.amount !==
      BigInt(onchain.maxQuoteAmount) - BigInt(onchain.spentQuoteAmount)
  )
    throw new Error('escrow mismatch');
  return fingerprint;
}

async function verifyDeliveredRequest(
  opening: BuyRequestOpeningV1,
): Promise<string> {
  const request = await fetchBuyRequest({
    rpcUrl,
    programAddress,
    requestAddress: opening.request,
  });
  if (!request) throw new Error('request mismatch');
  if (!request.lockedBatch) return verifyRequest(opening);
  const batch = await fetchBatch({
    rpcUrl,
    programAddress,
    batchAddress: request.lockedBatch,
  });
  const chainTime = await readChainTime();
  if (
    !batch ||
    batch.status !== 'locked' ||
    batch.market !== request.market ||
    !batch.requests.includes(opening.request) ||
    chainTime >= BigInt(batch.lockDeadline)
  )
    throw new Error('request mismatch');
  return verifyRequest(opening, batch.address, chainTime);
}

async function verifyPlan(
  opening: CanonicalStageV1,
  chainTime?: bigint,
): Promise<string> {
  const account = await readAccount(opening.plan);
  if (!account || account.programAddress !== programAddress)
    throw new Error('plan unavailable');
  const plan = decodePublicSellPlan(account.data, opening.plan);
  if (
    !plan ||
    plan.status !== 'active' ||
    plan.market !== opening.market ||
    plan.market !== (await expectedMarket) ||
    plan.currentStageIndex !== opening.stageIndex ||
    opening.rawQuantity > BigInt(plan.remainingRawInventory) ||
    BigInt(plan.expiresAtUnix) <= (chainTime ?? (await readChainTime()))
  )
    throw new Error('plan mismatch');
  const fingerprint = toHex(await hashCanonicalStage(opening));
  if (fingerprint !== plan.currentCommitment)
    throw new Error('stage commitment mismatch');
  const vault = await readAccount(plan.stockVault);
  if (!vault) throw new Error('stock vault unavailable');
  const stock = decodeToken(vault);
  if (
    stock.data.amount !== BigInt(plan.remainingRawInventory) ||
    stock.data.owner !== address(plan.address) ||
    stock.data.mint !== address(required('BAZO_STOCK_MINT')) ||
    stock.programAddress !== address(required('BAZO_STOCK_TOKEN_PROGRAM'))
  )
    throw new Error('stock vault mismatch');
  return fingerprint;
}

async function readAccount(key: string) {
  const target = address(key);
  const account = parseBase64RpcAccount(
    target,
    (
      await rpc
        .getAccountInfo(target, { encoding: 'base64', commitment: 'confirmed' })
        .send()
    ).value,
  );
  return account.exists ? account : null;
}

async function readChainTime(): Promise<bigint> {
  const clock = await readAccount(
    'SysvarC1ock11111111111111111111111111111111',
  );
  if (!clock || clock.data.length !== 40) throw new Error('clock unavailable');
  return new DataView(
    clock.data.buffer,
    clock.data.byteOffset,
    clock.data.byteLength,
  ).getBigInt64(32, true);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of request) {
    text += chunk.toString('utf8');
    if (text.length > 4_096) throw new Error('opening too large');
  }
  return JSON.parse(text) as unknown;
}

function authorized(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false;
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
const ingressErrorCodes = new Map([
  ['invalid opening', 'invalid_opening'],
  ['request mismatch', 'request_mismatch'],
  ['request expired', 'request_expired'],
  ['request commitment mismatch', 'request_commitment_mismatch'],
  ['escrow unavailable', 'escrow_unavailable'],
  ['escrow mismatch', 'escrow_mismatch'],
  ['plan unavailable', 'plan_unavailable'],
  ['plan mismatch', 'plan_mismatch'],
  ['stage commitment mismatch', 'stage_commitment_mismatch'],
  ['stock vault unavailable', 'stock_vault_unavailable'],
  ['stock vault mismatch', 'stock_vault_mismatch'],
]);
function safeIngressError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return ingressErrorCodes.get(message) ?? 'unavailable';
}
function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
}
