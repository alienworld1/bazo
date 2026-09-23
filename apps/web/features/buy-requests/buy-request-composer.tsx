'use client';

import { address } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token-2022';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  deriveMarketAddress,
  hashBuyRequestOpening,
  prepareBuyRequest,
  type BuyRequestOpeningV1,
} from '@bazo/sdk';
import {
  formatDisplayAmount,
  parseDisplayAmountToRaw,
} from '@/lib/token-amounts';
import type { MarketConfig, SupportedHolding } from '@/lib/markets';
import { canUseIndicativeBuyReference } from '@/lib/reference-policy';
import { solanaClient } from '@/components/solana-client';
import { ReferenceStatus } from '@/components/reference-status';
import {
  maxAffordableRawQuantity,
  quoteCapFromReference,
} from './quote-ceiling';
import { useBuyReference } from './use-buy-reference';
import { rememberBuyRequestOpening } from './private-buy-request-memory';
import { reconcileFundedBuyRequest } from './reconcile-buy-request';
import { BuyRequestReview } from './buy-request-review';
import { BuyRequestField as Field } from './buy-request-field';
import type { PreparedBuyRequest } from './buy-request-types';
import { simulateBuyRequest } from './simulate-buy-request';

type QuoteBalance = {
  rawAmount: string;
  sourceTokenAccount: string | null;
  decimals: number;
};

const MIN_SIGNING_WINDOW_SECONDS = 120n;
const EXPIRY_FINALITY_BUFFER_SECONDS = 60n;

export function BuyRequestComposer({
  market,
  programAddress,
}: {
  market: MarketConfig;
  programAddress: string;
}) {
  const connected = useConnectedWallet(solanaClient);
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const buyer = connected?.account.address;
  const [balance, setBalance] = useState<QuoteBalance>();
  const [holding, setHolding] = useState<SupportedHolding>();
  const [quantity, setQuantity] = useState('');
  const [premium, setPremium] = useState('1');
  const [expiry, setExpiry] = useState('');
  const [partial, setPartial] = useState(true);
  const [prepared, setPrepared] = useState<PreparedBuyRequest>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [balanceError, setBalanceError] = useState<string>();
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const referenceState = useBuyReference(market.id);
  const { reference } = referenceState;
  useEffect(() => {
    void Promise.resolve().then(() => {
      setMounted(true);
      setExpiry(defaultExpiry(market.batchDurationSeconds));
    });
  }, [market.batchDurationSeconds]);
  const quantityError =
    quantity &&
    holding &&
    !isRepresentableQuantity(
      quantity,
      market.tokenDecimals,
      holding.multiplierContext ?? '1',
    )
      ? `Enter a positive ${market.symbol} quantity supported by this stock mint.`
      : undefined;
  const premiumError =
    premium && !isValidPremium(premium)
      ? 'Enter a signed percentage with no more than two decimal places, above -100%.'
      : undefined;
  const loadBalance = useCallback(async () => {
    if (!buyer) return;
    setBalance(undefined);
    setHolding(undefined);
    setBalanceError(undefined);
    const [quoteResult, holdingResult] = await Promise.allSettled([
      (async () => {
        const response = await fetch(
          `/api/markets/${market.id}/quote-balance?owner=${encodeURIComponent(buyer)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('quote');
        return (await response.json()) as QuoteBalance;
      })(),
      (async () => {
        const response = await fetch(
          `/api/markets/${market.id}/holding?owner=${encodeURIComponent(buyer)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('stock');
        return (await response.json()) as SupportedHolding;
      })(),
    ]);
    if (quoteResult.status === 'fulfilled') setBalance(quoteResult.value);
    if (holdingResult.status === 'fulfilled') setHolding(holdingResult.value);
    if (
      quoteResult.status === 'rejected' &&
      holdingResult.status === 'rejected'
    ) {
      setBalanceError("We couldn't refresh your wallet balances. Try again.");
    } else if (quoteResult.status === 'rejected') {
      setBalanceError("We couldn't read your quote balance. Try again.");
    } else if (holdingResult.status === 'rejected') {
      setBalanceError("We couldn't read this stock's mint details. Try again.");
    }
  }, [buyer, market.id]);
  useEffect(() => {
    if (buyer) void Promise.resolve().then(loadBalance);
  }, [buyer, loadBalance]);
  const draft = useMemo(() => {
    try {
      if (!quantity || !balance || !holding) return;
      const multiplier = holding.multiplierContext ?? '1';
      const raw = BigInt(
        parseDisplayAmountToRaw(quantity, market.tokenDecimals, multiplier),
      );
      if (
        raw <= 0n ||
        raw > 18_446_744_073_709_551_615n ||
        normalizeDecimal(
          formatDisplayAmount(raw.toString(), market.tokenDecimals, multiplier),
        ) !== normalizeDecimal(quantity)
      )
        return;
      const bps = parsePremium(premium);
      const expiresAt = BigInt(Math.floor(new Date(expiry).getTime() / 1000));
      if (!Number.isFinite(Number(expiresAt))) return;
      return { raw, bps, expiresAt };
    } catch {
      return;
    }
  }, [balance, expiry, holding, market.tokenDecimals, premium, quantity]);
  const suggestedQuote = computeSuggestedQuote(
    draft,
    reference,
    market.tokenDecimals,
    holding?.multiplierContext ?? '1',
    balance?.decimals ?? 0,
  );
  const canReview = Boolean(
    buyer &&
    balance?.sourceTokenAccount &&
    draft &&
    suggestedQuote > 0n &&
    suggestedQuote <= BigInt(balance.rawAmount) &&
    suggestedQuote <= 18_446_744_073_709_551_615n,
  );
  const useMaximum = () => {
    if (!balance || !holding || !canUseIndicativeBuyReference(reference))
      return;
    try {
      const raw = maxAffordableRawQuantity(BigInt(balance.rawAmount), {
        stockDecimals: market.tokenDecimals,
        stockMultiplier: holding.multiplierContext ?? '1',
        quoteDecimals: balance.decimals,
        referencePrice: reference.price,
        referenceExponent: reference.exponent,
        premiumBps: parsePremium(premium),
      });
      if (raw > 0n)
        setQuantity(
          formatDisplayAmount(
            raw.toString(),
            market.tokenDecimals,
            holding.multiplierContext ?? '1',
          ),
        );
    } catch {
      setError('Choose a valid premium before using your maximum balance.');
    }
  };
  const review = async () => {
    if (!buyer || !balance?.sourceTokenAccount || !draft || !canReview) return;
    if (
      draft.expiresAt <=
      BigInt(Math.floor(Date.now() / 1000)) + MIN_SIGNING_WINDOW_SECONDS
    ) {
      setError('Choose an expiry at least two minutes from now.');
      return;
    }
    setError(undefined);
    setStatus('Preparing request…');
    try {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
      const nonce = new DataView(nonceBytes.buffer).getBigUint64(0, true);
      const marketAddress = await deriveMarketAddress(address(programAddress), {
        stockMint: address(market.stockMint),
        quoteMint: address(market.quoteMint),
      });
      const [recipientStockAccount] = await findAssociatedTokenPda({
        owner: address(buyer),
        mint: address(market.stockMint),
        tokenProgram: address(market.stockTokenProgram),
      });
      const provisional = await prepareBuyRequest({
        programAddress: address(programAddress),
        buyer: address(buyer),
        recipient: address(buyer),
        market: marketAddress,
        stockMint: address(market.stockMint),
        stockTokenProgram: address(market.stockTokenProgram),
        recipientStockAccount,
        quoteMint: address(market.quoteMint),
        quoteTokenProgram: address(market.quoteTokenProgram),
        buyerQuoteAccount: address(balance.sourceTokenAccount),
        requestNonce: nonce,
        requestCommitment: new Uint8Array(32).fill(1),
        maxQuoteAmount: suggestedQuote,
        expiresAt: draft.expiresAt,
      });
      const opening: BuyRequestOpeningV1 = {
        schemaVersion: 1,
        network: 1,
        request: provisional.request,
        buyer: address(buyer),
        recipient: address(buyer),
        market: marketAddress,
        targetRawQuantity: draft.raw,
        maxPremiumBps: draft.bps,
        maxQuoteAmount: suggestedQuote,
        expiresAt: draft.expiresAt,
        allowPartialFills: partial,
        requestNonce: nonce,
        salt: crypto.getRandomValues(new Uint8Array(32)),
      };
      const commitment = await hashBuyRequestOpening(opening);
      const funded = await prepareBuyRequest({
        programAddress: address(programAddress),
        buyer: address(buyer),
        recipient: address(buyer),
        market: marketAddress,
        stockMint: address(market.stockMint),
        stockTokenProgram: address(market.stockTokenProgram),
        recipientStockAccount,
        quoteMint: address(market.quoteMint),
        quoteTokenProgram: address(market.quoteTokenProgram),
        buyerQuoteAccount: address(balance.sourceTokenAccount),
        requestNonce: nonce,
        requestCommitment: commitment,
        maxQuoteAmount: suggestedQuote,
        expiresAt: draft.expiresAt,
      });
      const createRecipient = getCreateAssociatedTokenIdempotentInstruction({
        payer: solanaClient.payer,
        ata: recipientStockAccount,
        owner: address(buyer),
        mint: address(market.stockMint),
        tokenProgram: address(market.stockTokenProgram),
      });
      await simulateBuyRequest([createRecipient, funded.instruction]);
      setPrepared({
        request: provisional.request,
        escrow: provisional.escrow,
        nonce,
        commitment,
        opening,
        quantityRaw: draft.raw,
        premiumBps: draft.bps,
        quoteRaw: suggestedQuote,
        expiresAt: draft.expiresAt,
        quoteDecimals: balance.decimals,
        multiplier: holding?.multiplierContext ?? '1',
        sourceTokenAccount: balance.sourceTokenAccount,
        balanceAfter: BigInt(balance.rawAmount) - suggestedQuote,
        referenceLabel: canUseIndicativeBuyReference(reference)
          ? `${reference.formattedPrice} (${reference.feedUpdateTimestamp})`
          : 'Unavailable',
      });
      setStatus(undefined);
    } catch {
      setStatus(undefined);
      setError("We couldn't prepare this request. Nothing moved.");
    }
  };
  const recoverExpiredRequest = async (request: PreparedBuyRequest) => {
    if (
      BigInt(Math.floor(Date.now() / 1000)) <
      request.expiresAt + EXPIRY_FINALITY_BUFFER_SECONDS
    )
      return false;
    const account = await solanaClient.rpc
      .getAccountInfo(address(request.request), {
        encoding: 'base64',
        commitment: 'finalized',
      })
      .send();
    if (account.value !== null) return false;
    setStatus(undefined);
    setSubmissionUncertain(false);
    setPrepared(undefined);
    setError(
      `This request expired before it reached Devnet. No ${market.quoteSymbol} was locked. Choose a new expiry and review it again.`,
    );
    void loadBalance();
    return true;
  };
  const place = async () => {
    if (
      !prepared ||
      !buyer ||
      buyer !== prepared.opening.buyer ||
      !balance?.sourceTokenAccount ||
      submissionUncertain
    )
      return;
    if (
      prepared.expiresAt <=
      BigInt(Math.floor(Date.now() / 1000)) + MIN_SIGNING_WINDOW_SECONDS
    ) {
      setPrepared(undefined);
      setError(
        'This request is too close to expiry. Choose a later time and review it again.',
      );
      return;
    }
    setError(undefined);
    let approvalStarted = false;
    try {
      setStatus('Checking transaction…');
      const [quoteResponse, holdingResponse] = await Promise.all([
        fetch(
          `/api/markets/${market.id}/quote-balance?owner=${encodeURIComponent(buyer)}`,
          { cache: 'no-store' },
        ),
        fetch(
          `/api/markets/${market.id}/holding?owner=${encodeURIComponent(buyer)}`,
          { cache: 'no-store' },
        ),
      ]);
      if (!quoteResponse.ok || !holdingResponse.ok)
        throw new Error('balance refresh failed');
      const currentQuote = (await quoteResponse.json()) as QuoteBalance;
      const currentHolding = (await holdingResponse.json()) as SupportedHolding;
      if (
        currentQuote.sourceTokenAccount !== prepared.sourceTokenAccount ||
        currentQuote.decimals !== prepared.quoteDecimals ||
        BigInt(currentQuote.rawAmount) < prepared.quoteRaw ||
        (currentHolding.multiplierContext ?? '1') !== prepared.multiplier
      ) {
        setBalance(currentQuote);
        setHolding(currentHolding);
        setPrepared(undefined);
        setError('Market or wallet values changed. Review the request again.');
        setStatus(undefined);
        return;
      }
      const marketAddress = await deriveMarketAddress(address(programAddress), {
        stockMint: address(market.stockMint),
        quoteMint: address(market.quoteMint),
      });
      const [recipientStockAccount] = await findAssociatedTokenPda({
        owner: address(buyer),
        mint: address(market.stockMint),
        tokenProgram: address(market.stockTokenProgram),
      });
      const instruction = await prepareBuyRequest({
        programAddress: address(programAddress),
        buyer: address(buyer),
        recipient: address(buyer),
        market: marketAddress,
        stockMint: address(market.stockMint),
        stockTokenProgram: address(market.stockTokenProgram),
        recipientStockAccount,
        quoteMint: address(market.quoteMint),
        quoteTokenProgram: address(market.quoteTokenProgram),
        buyerQuoteAccount: address(prepared.sourceTokenAccount),
        requestNonce: prepared.nonce,
        requestCommitment: prepared.commitment,
        maxQuoteAmount: prepared.quoteRaw,
        expiresAt: prepared.expiresAt,
      });
      const createRecipient = getCreateAssociatedTokenIdempotentInstruction({
        payer: solanaClient.payer,
        ata: recipientStockAccount,
        owner: address(buyer),
        mint: address(market.stockMint),
        tokenProgram: address(market.stockTokenProgram),
      });
      if (instruction.request !== prepared.request)
        throw new Error('stale review');
      await simulateBuyRequest([createRecipient, instruction.instruction]);
      if (
        prepared.expiresAt <=
        BigInt(Math.floor(Date.now() / 1000)) + MIN_SIGNING_WINDOW_SECONDS
      ) {
        setStatus(undefined);
        setPrepared(undefined);
        setError(
          'This request is too close to expiry. Choose a later time and review it again.',
        );
        return;
      }
      setStatus('Awaiting approval…');
      approvalStarted = true;
      const result = await solanaClient.sendTransaction([
        createRecipient,
        instruction.instruction,
      ]);
      setStatus('Confirming…');
      setStatus('Verifying request…');
      const reconciled = await reconcileFundedBuyRequest({
        requestAddress: prepared.request,
        buyer,
        recipient: buyer,
        market: marketAddress,
        escrow: prepared.escrow,
        quoteRawAmount: prepared.quoteRaw,
        expiresAt: prepared.expiresAt,
        commitment: prepared.commitment,
      });
      if (!reconciled) {
        setSubmissionUncertain(true);
        setError(
          "Your transaction was confirmed, but we couldn't verify the request yet. Your funds remain governed by the onchain request.",
        );
        setStatus(undefined);
        return;
      }
      rememberBuyRequestOpening(prepared.opening);
      router.replace(
        `/buy-requests/${prepared.request}?signature=${result.context.signature}`,
      );
    } catch (failure) {
      setStatus(undefined);
      if (!approvalStarted) {
        setError(
          "This request can't be funded as prepared. Nothing moved. Refresh the details and review again.",
        );
        return;
      }
      setSubmissionUncertain(true);
      try {
        if (
          await reconcileFundedBuyRequest({
            requestAddress: prepared.request,
            buyer,
            recipient: buyer,
            market: prepared.opening.market,
            escrow: prepared.escrow,
            quoteRawAmount: prepared.quoteRaw,
            expiresAt: prepared.expiresAt,
            commitment: prepared.commitment,
          })
        ) {
          rememberBuyRequestOpening(prepared.opening);
          router.replace(`/buy-requests/${prepared.request}`);
          return;
        }
      } catch {
        // Verification may be temporarily unavailable.
      }
      try {
        if (await recoverExpiredRequest(prepared)) return;
      } catch {
        // Keep the request uncertain if Devnet cannot establish its absence.
      }
      const rejected =
        failure instanceof Error && /reject|cancel/i.test(failure.message);
      if (rejected) setSubmissionUncertain(false);
      setError(
        rejected
          ? 'Transaction canceled. Nothing moved.'
          : "We couldn't confirm this request. Check its address before trying again; your funds may already be locked.",
      );
    }
  };
  const retryVerification = async () => {
    if (!prepared || !buyer || buyer !== prepared.opening.buyer) return;
    setStatus('Verifying request…');
    let verificationUnavailable = false;
    try {
      if (
        await reconcileFundedBuyRequest({
          requestAddress: prepared.request,
          buyer,
          recipient: buyer,
          market: prepared.opening.market,
          escrow: prepared.escrow,
          quoteRawAmount: prepared.quoteRaw,
          expiresAt: prepared.expiresAt,
          commitment: prepared.commitment,
        })
      ) {
        rememberBuyRequestOpening(prepared.opening);
        router.replace(`/buy-requests/${prepared.request}`);
        return;
      }
    } catch {
      verificationUnavailable = true;
    }
    try {
      if (await recoverExpiredRequest(prepared)) return;
    } catch {
      verificationUnavailable = true;
    }
    setError(
      verificationUnavailable
        ? 'Devnet is temporarily unavailable. Your funds remain governed by any onchain request.'
        : "We haven't verified this request yet. Wait for Devnet to settle before changing your request.",
    );
    setStatus(undefined);
  };
  // Wallet state is browser-only and can already be populated during the
  // first client render. Keep the server and hydration markup consistent.
  if (!mounted || !connected)
    return (
      <section className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-medium text-text-primary">
          Buy {market.symbol}
        </h1>
        <p className="mt-3 text-text-secondary">
          Connect a wallet to fund this Buy Request.
        </p>
        <div className="mt-8">
          <ReferenceStatus marketId={market.id} />
        </div>
      </section>
    );
  if (prepared && buyer === prepared.opening.buyer)
    return (
      <BuyRequestReview
        market={market}
        prepared={prepared}
        status={status}
        error={error}
        uncertain={submissionUncertain}
        onPlace={() => void place()}
        onBack={() => setPrepared(undefined)}
        onVerify={() => void retryVerification()}
      />
    );
  return (
    <section className="mx-auto max-w-7xl">
      <p className="font-mono text-xs text-text-tertiary">
        BUY {market.symbol}
      </p>
      <h1 className="mt-3 text-3xl font-medium text-text-primary">
        Buy {market.symbol}
      </h1>
      <p className="mt-3 text-text-secondary">
        Set the most you want to buy and the highest premium you will accept.
      </p>
      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(280px,4fr)]">
        <form
          className="space-y-8"
          onSubmit={event => {
            event.preventDefault();
            void review();
          }}
        >
          <Field label="Maximum quantity">
            <input
              value={quantity}
              onChange={event => {
                setQuantity(event.target.value);
                setPrepared(undefined);
              }}
              inputMode="decimal"
              aria-invalid={Boolean(quantityError)}
              aria-describedby={
                quantityError ? 'buy-quantity-error' : undefined
              }
              className="mt-2 h-16 w-full border border-line-default bg-surface-1 px-4 text-2xl tabular-nums text-text-primary"
            />
          </Field>
          {quantityError ? (
            <p
              id="buy-quantity-error"
              role="alert"
              className="text-sm text-warning"
            >
              {quantityError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={useMaximum}
            disabled={
              !balance?.sourceTokenAccount ||
              !holding ||
              !canUseIndicativeBuyReference(reference)
            }
            className="min-h-11 border border-line-default px-4 text-sm text-text-primary disabled:text-text-disabled"
          >
            Use maximum
          </button>
          <Field label="Maximum premium to Pyth">
            <input
              value={premium}
              onChange={event => {
                setPremium(event.target.value);
                setPrepared(undefined);
              }}
              inputMode="decimal"
              aria-invalid={Boolean(premiumError)}
              aria-describedby={premiumError ? 'buy-premium-error' : undefined}
              className="mt-2 h-16 w-full border border-line-default bg-surface-1 px-4 text-2xl tabular-nums text-text-primary"
            />
            <p className="mt-2 text-sm text-text-secondary">
              The most you will pay above or below the verified underlying
              reference.
            </p>
          </Field>
          {premiumError ? (
            <p
              id="buy-premium-error"
              role="alert"
              className="text-sm text-warning"
            >
              {premiumError}
            </p>
          ) : null}
          <Field label="Request expires">
            <input
              type="datetime-local"
              value={expiry}
              onChange={event => setExpiry(event.target.value)}
              className="mt-2 min-h-11 w-full border border-line-default bg-surface-1 px-3 text-text-primary"
            />
          </Field>
          <label className="flex gap-3 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={partial}
              onChange={event => setPartial(event.target.checked)}
            />{' '}
            <span>
              Allow partial fills
              <br />
              <span className="text-text-secondary">
                Your request can remain active after a smaller fill.
              </span>
            </span>
          </label>
          {balanceError ? (
            <p role="alert" className="text-sm text-warning">
              {balanceError}{' '}
              <button
                type="button"
                onClick={() => void loadBalance()}
                className="underline"
              >
                Retry
              </button>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-warning">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!canReview}
            className="min-h-12 w-full border border-line-strong bg-surface-3 px-5 text-sm text-text-primary disabled:text-text-disabled"
          >
            Review request
          </button>
        </form>
        <aside className="border-y border-line-default py-5">
          <h2 className="font-medium text-text-primary">Market and escrow</h2>
          <div className="mt-5">
            <ReferenceStatus marketId={market.id} state={referenceState} />
          </div>
          <p className="mt-6 text-sm text-text-secondary">
            Current indicative ceiling
          </p>
          <p className="mt-1 tabular-nums text-text-primary">
            {canUseIndicativeBuyReference(reference) &&
            suggestedQuote > 0n &&
            balance
              ? `${formatDisplayAmount(suggestedQuote.toString(), balance.decimals)} ${market.quoteSymbol}`
              : 'Unavailable'}
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            Indicative only. Settlement uses the verified Pyth reference at that
            time.
          </p>
          {reference?.status === 'session_not_allowed' ? (
            <p className="mt-2 text-sm text-text-secondary">
              You can prepare a request now. This Market settles only during its
              supported session, so choose an expiry that gives it time to reopen.
            </p>
          ) : null}
          <p className="mt-6 text-sm text-text-secondary">
            Spendable {market.quoteSymbol} balance
          </p>
          <p className="mt-1 font-mono text-sm text-text-primary">
            {balance
              ? `${formatDisplayAmount(balance.rawAmount, balance.decimals)} (${balance.rawAmount} raw)`
              : 'Checking quote balance…'}
          </p>
          {balance?.rawAmount === '0' ? (
            <p className="mt-2 break-all text-sm text-text-secondary">
              Your connected wallet needs this Market&apos;s Devnet{' '}
              {market.quoteSymbol} test token before you can place a request.
              Mint: {market.quoteMint}
            </p>
          ) : null}
          <p className="mt-6 text-sm text-text-secondary">Quote to lock</p>
          <p className="mt-1 font-mono text-sm text-text-primary">
            {suggestedQuote > 0n && balance
              ? `${formatDisplayAmount(suggestedQuote.toString(), balance.decimals)} ${market.quoteSymbol}`
              : 'Enter a quantity and wait for a verified reference'}
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            These funds stay in this request until they are spent in a valid
            settlement or become refundable.
          </p>
          <p className="mt-5 text-sm text-text-secondary">
            The stock and quote shown here are Devnet test assets, not
            issuer-backed shares or dollars.
          </p>
        </aside>
      </div>
    </section>
  );
}
function parsePremium(value: string): number {
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(value)) throw new Error('premium');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  const signed = negative ? -bps : bps;
  if (signed <= -10_000n || signed > 2_147_483_647n) throw new Error('premium');
  return Number(signed);
}
function defaultExpiry(batchDurationSeconds: number): string {
  const date = new Date(
    Date.now() + Math.max(86_400, batchDurationSeconds * 2) * 1_000,
  );
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function normalizeDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${BigInt(whole)}.${fraction.replace(/0+$/, '')}`;
}
function isRepresentableQuantity(
  value: string,
  decimals: number,
  multiplier: string,
): boolean {
  try {
    const raw = BigInt(parseDisplayAmountToRaw(value, decimals, multiplier));
    return (
      raw > 0n &&
      raw <= 18_446_744_073_709_551_615n &&
      normalizeDecimal(
        formatDisplayAmount(raw.toString(), decimals, multiplier),
      ) === normalizeDecimal(value)
    );
  } catch {
    return false;
  }
}
function isValidPremium(value: string): boolean {
  try {
    parsePremium(value);
    return true;
  } catch {
    return false;
  }
}
function computeSuggestedQuote(
  draft: { raw: bigint; bps: number } | undefined,
  reference: import('@/lib/markets').NormalizedReference | undefined,
  stockDecimals: number,
  stockMultiplier: string,
  quoteDecimals: number,
): bigint {
  if (!draft || !canUseIndicativeBuyReference(reference)) return 0n;
  try {
    return quoteCapFromReference({
      targetRawQuantity: draft.raw,
      stockDecimals,
      stockMultiplier,
      quoteDecimals,
      referencePrice: reference.price,
      referenceExponent: reference.exponent,
      premiumBps: draft.bps,
    });
  } catch {
    return 0n;
  }
}
