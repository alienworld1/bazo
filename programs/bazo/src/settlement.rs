use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as Token2022Mint,
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::settlement_math::quote_charge;
use crate::settlement_reference::{verify_reference, VerifierAccounts};
use crate::{
    allocate_stage, hash_canonical_buy_request, hash_canonical_stage, terminal_commitment,
    validate_quote_mint_extensions, validate_stock_mint_extensions,
    validate_transfer_account_extensions, Batch, BazoError, BuyRequest,
    CanonicalBuyRequestOpeningV1, CanonicalStageV1, Market, MatchBuyer, Plan, PlanReservation,
    SettlementPolicy, BATCH_LOCKED, BATCH_SEED, BATCH_SETTLED, BATCH_VERSION, BUY_ESCROW_SEED,
    BUY_REQUEST_FILLED, BUY_REQUEST_SEED, BUY_REQUEST_VERSION, COMMITMENT_SCHEMA_VERSION,
    DEVNET_NETWORK_ID, MARKET_SEED, MAX_BATCH_REQUESTS, PLAN_COMPLETE, PLAN_RESERVATION_SEED,
    PLAN_RESERVATION_VERSION, PLAN_SEED, PLAN_VERSION, PROCEEDS_VAULT_SEED, SETTLEMENT_POLICY_SEED,
    SETTLEMENT_POLICY_VERSION, STATUS_ACTIVE, STOCK_VAULT_SEED,
};

pub const RECEIPT_SEED: &[u8] = b"sale-receipt";
pub const BATCH_OUTCOME_SEED: &[u8] = b"batch-outcome";
pub const RECEIPT_VERSION: u16 = 1;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StageExecution {
    pub raw_quantity: u64,
    pub min_premium_bps: i32,
    pub allowed_session_mask: u8,
    pub max_reference_age_seconds: u32,
    pub next_commitment: [u8; 32],
    pub salt: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RequestExecution {
    pub target_raw_quantity: u64,
    pub max_premium_bps: i32,
    pub allow_partial_fills: bool,
    pub salt: [u8; 32],
}

#[derive(Accounts)]
pub struct SettleStage<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        seeds = [MARKET_SEED, market.stock_mint.as_ref(), market.quote_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        has_one = market @ BazoError::MarketMismatch,
        seeds = [SETTLEMENT_POLICY_SEED, market.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Box<Account<'info, SettlementPolicy>>,
    #[account(
        mut,
        has_one = market @ BazoError::MarketMismatch,
        has_one = stock_vault @ BazoError::MarketMismatch,
        has_one = proceeds_vault @ BazoError::MarketMismatch,
        seeds = [PLAN_SEED, &PLAN_VERSION.to_le_bytes(), plan.owner.as_ref(), &plan.plan_nonce.to_le_bytes()],
        bump = plan.bump,
    )]
    pub plan: Box<Account<'info, Plan>>,
    #[account(
        mut,
        close = caller,
        has_one = plan @ BazoError::MarketMismatch,
        has_one = batch @ BazoError::MarketMismatch,
        seeds = [PLAN_RESERVATION_SEED, plan.key().as_ref(), &plan.current_stage_index.to_le_bytes()],
        bump = reservation.bump,
    )]
    pub reservation: Box<Account<'info, PlanReservation>>,
    #[account(
        mut,
        has_one = market @ BazoError::MarketMismatch,
        seeds = [BATCH_SEED, &BATCH_VERSION.to_le_bytes(), market.key().as_ref(), &batch.window_start.to_le_bytes()],
        bump = batch.bump,
    )]
    pub batch: Box<Account<'info, Batch>>,
    #[account(
        init,
        payer = caller,
        space = 8 + SettlementReceipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, plan.key().as_ref(), &plan.current_stage_index.to_le_bytes()],
        bump,
    )]
    pub receipt: Box<Account<'info, SettlementReceipt>>,
    #[account(
        init,
        payer = caller,
        space = 8 + BatchOutcome::INIT_SPACE,
        seeds = [BATCH_OUTCOME_SEED, batch.key().as_ref()],
        bump,
    )]
    pub outcome: Box<Account<'info, BatchOutcome>>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [STOCK_VAULT_SEED, plan.key().as_ref()],
        bump,
        constraint = stock_vault.owner == plan.key() @ BazoError::InvalidStockSource,
        constraint = stock_vault.mint == stock_mint.key() @ BazoError::MarketMismatch,
    )]
    pub stock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [PROCEEDS_VAULT_SEED, plan.key().as_ref()],
        bump,
        constraint = proceeds_vault.owner == plan.key() @ BazoError::ProceedsAccountingMismatch,
        constraint = proceeds_vault.mint == quote_mint.key() @ BazoError::MarketMismatch,
    )]
    pub proceeds_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = market.stock_token_program @ BazoError::MarketMismatch)]
    pub stock_token_program: Interface<'info, TokenInterface>,
    #[account(address = market.quote_token_program @ BazoError::MarketMismatch)]
    pub quote_token_program: Interface<'info, TokenInterface>,
    /// CHECK: The exact official verifier program ID is checked before CPI.
    pub pyth_program: UncheckedAccount<'info>,
    /// CHECK: The verifier checks ownership, seeds, and trusted signer state.
    pub pyth_storage: UncheckedAccount<'info>,
    /// CHECK: The verifier binds this writable treasury to its storage account.
    #[account(mut)]
    pub pyth_treasury: UncheckedAccount<'info>,
    /// CHECK: The verifier checks this system instruction sysvar account.
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct SettlementReceipt {
    pub version: u16,
    pub market: Pubkey,
    pub batch: Pubkey,
    pub plan: Pubkey,
    pub stage_index: u16,
    pub raw_stock_quantity: u64,
    pub raw_quote_quantity: u64,
    pub clearing_premium_bps: i32,
    pub reference_price: i64,
    pub reference_exponent: i16,
    pub reference_confidence: i64,
    pub reference_publisher_count: u16,
    pub reference_session_mask: u8,
    pub pyth_feed_id: u64,
    pub feed_update_timestamp_us: u64,
    pub executed_at: i64,
    pub request_count: u8,
    pub requests: [Pubkey; MAX_BATCH_REQUESTS],
    pub raw_fills: [u64; MAX_BATCH_REQUESTS],
    pub raw_quote_charges: [u64; MAX_BATCH_REQUESTS],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BatchOutcome {
    pub version: u16,
    pub batch: Pubkey,
    pub plan: Pubkey,
    pub receipt: Pubkey,
    pub bump: u8,
}

#[event]
pub struct StageSold {
    pub receipt: Pubkey,
    pub plan: Pubkey,
    pub batch: Pubkey,
    pub raw_stock_quantity: u64,
    pub raw_quote_quantity: u64,
}

pub fn settle_stage<'info>(
    ctx: Context<'info, SettleStage<'info>>,
    stage: StageExecution,
    requests: Vec<RequestExecution>,
    signed_reference: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &ctx.accounts.market;
    let plan = &ctx.accounts.plan;
    let batch = &ctx.accounts.batch;
    let batch_key = batch.key();
    let batch_requests = batch.requests.clone();
    require!(
        market.enabled && market.version == PLAN_VERSION,
        BazoError::MarketDisabled
    );
    require!(
        ctx.accounts.policy.version == SETTLEMENT_POLICY_VERSION,
        BazoError::InvalidSettlementPolicy
    );
    require!(
        plan.version == PLAN_VERSION && plan.status == STATUS_ACTIVE && plan.expires_at > now,
        BazoError::ExpiredPlan
    );
    require!(
        batch.version == BATCH_VERSION && batch.status == BATCH_LOCKED && now < batch.lock_deadline,
        BazoError::BatchWindowEnded
    );
    require!(
        ctx.accounts.reservation.version == PLAN_RESERVATION_VERSION
            && ctx.accounts.reservation.stage_index == plan.current_stage_index
            && ctx.accounts.reservation.lock_deadline == batch.lock_deadline,
        BazoError::BatchWindowEnded
    );
    require!(
        market.stock_mint == ctx.accounts.stock_mint.key()
            && market.quote_mint == ctx.accounts.quote_mint.key(),
        BazoError::MarketMismatch
    );
    require!(
        market.stock_token_program == anchor_spl::token_2022::ID
            && market.quote_token_program == anchor_spl::token_2022::ID,
        BazoError::UnsupportedTokenProgram
    );
    require!(
        stage.raw_quantity >= market.minimum_stage_raw_amount
            && stage.raw_quantity <= plan.remaining_raw_inventory,
        BazoError::InvalidInventoryAmount
    );
    require!(
        ctx.accounts.stock_vault.amount == plan.remaining_raw_inventory,
        BazoError::InsufficientStock
    );
    require!(
        stage.min_premium_bps > -10_000
            && stage.max_reference_age_seconds > 0
            && stage.allowed_session_mask != 0,
        BazoError::InvalidCommitment
    );
    require!(
        requests.len() == batch.requests.len()
            && !requests.is_empty()
            && requests.len() <= MAX_BATCH_REQUESTS,
        BazoError::InvalidBatchSet
    );
    require!(
        ctx.remaining_accounts.len() == requests.len() * 3,
        BazoError::InvalidBatchSet
    );
    validate_stock_mint_extensions(&ctx.accounts.stock_mint.to_account_info())?;
    validate_quote_mint_extensions(&ctx.accounts.quote_mint.to_account_info())?;
    validate_transfer_account_extensions(&ctx.accounts.stock_vault.to_account_info())?;
    validate_transfer_account_extensions(&ctx.accounts.proceeds_vault.to_account_info())?;

    let opening = CanonicalStageV1 {
        schema_version: COMMITMENT_SCHEMA_VERSION,
        network: DEVNET_NETWORK_ID,
        plan: plan.key(),
        market: market.key(),
        stage_index: plan.current_stage_index,
        raw_quantity: stage.raw_quantity,
        min_premium_bps: stage.min_premium_bps,
        allowed_session_mask: stage.allowed_session_mask,
        max_reference_age_seconds: stage.max_reference_age_seconds,
        next_commitment: stage.next_commitment,
        salt: stage.salt,
    };
    require!(
        hash_canonical_stage(&opening)? == plan.current_stage_commitment,
        BazoError::InvalidCommitment
    );

    let buyers = verify_requests(&ctx, &requests, now)?;
    let (allocations, clearing_premium_bps) =
        allocate_stage(stage.raw_quantity, stage.min_premium_bps, &buyers)
            .ok_or(BazoError::InvalidBatchSet)?;
    let verifier = VerifierAccounts {
        payer: &ctx.accounts.caller.to_account_info(),
        program: &ctx.accounts.pyth_program.to_account_info(),
        storage: &ctx.accounts.pyth_storage.to_account_info(),
        treasury: &ctx.accounts.pyth_treasury.to_account_info(),
        system_program: &ctx.accounts.system_program.to_account_info(),
        instructions_sysvar: &ctx.accounts.instructions_sysvar.to_account_info(),
    };
    let reference = verify_reference(
        &signed_reference,
        &verifier,
        market,
        &ctx.accounts.policy,
        stage.allowed_session_mask,
        stage.max_reference_age_seconds,
        now,
    )?;
    let multiplier_bits = stock_multiplier_bits(&ctx.accounts.stock_mint.to_account_info(), now)?;
    let (fills, charges, total_quote) = calculate_charges(
        &ctx,
        &allocations,
        clearing_premium_bps,
        multiplier_bits,
        reference.price,
        reference.exponent,
    )?;
    transfer_and_update_requests(&ctx, &requests, &fills, &charges)?;

    let plan = &mut ctx.accounts.plan;
    plan.remaining_raw_inventory = plan
        .remaining_raw_inventory
        .checked_sub(stage.raw_quantity)
        .ok_or(BazoError::InvalidInventoryAmount)?;
    plan.sold_raw_inventory = plan
        .sold_raw_inventory
        .checked_add(stage.raw_quantity)
        .ok_or(BazoError::InvalidInventoryAmount)?;
    plan.quote_proceeds_accrued = plan
        .quote_proceeds_accrued
        .checked_add(total_quote)
        .ok_or(BazoError::ProceedsAccountingMismatch)?;
    plan.current_stage_index = plan
        .current_stage_index
        .checked_add(1)
        .ok_or(BazoError::InvalidCommitment)?;
    plan.current_stage_commitment = stage.next_commitment;
    if stage.next_commitment == terminal_commitment(plan.key(), market.key()) {
        plan.status = PLAN_COMPLETE;
    }
    ctx.accounts.batch.status = BATCH_SETTLED;
    let receipt = &mut ctx.accounts.receipt;
    receipt.version = RECEIPT_VERSION;
    receipt.market = market.key();
    receipt.batch = batch_key;
    receipt.plan = plan.key();
    receipt.stage_index = opening.stage_index;
    receipt.raw_stock_quantity = stage.raw_quantity;
    receipt.raw_quote_quantity = total_quote;
    receipt.clearing_premium_bps = clearing_premium_bps;
    receipt.reference_price = reference.price;
    receipt.reference_exponent = reference.exponent;
    receipt.reference_confidence = reference.confidence;
    receipt.reference_publisher_count = reference.publisher_count;
    receipt.reference_session_mask = reference.session_mask;
    receipt.pyth_feed_id = market.pyth_feed_id;
    receipt.feed_update_timestamp_us = reference.feed_update_timestamp_us;
    receipt.executed_at = now;
    receipt.request_count = requests.len() as u8;
    receipt.requests = [Pubkey::default(); MAX_BATCH_REQUESTS];
    receipt.raw_fills = [0; MAX_BATCH_REQUESTS];
    receipt.raw_quote_charges = [0; MAX_BATCH_REQUESTS];
    for (index, request) in batch_requests.iter().enumerate() {
        receipt.requests[index] = *request;
        receipt.raw_fills[index] = fills[index];
        receipt.raw_quote_charges[index] = charges[index];
    }
    receipt.bump = ctx.bumps.receipt;
    let outcome = &mut ctx.accounts.outcome;
    outcome.version = RECEIPT_VERSION;
    outcome.batch = batch_key;
    outcome.plan = plan.key();
    outcome.receipt = receipt.key();
    outcome.bump = ctx.bumps.outcome;
    emit!(StageSold {
        receipt: receipt.key(),
        plan: plan.key(),
        batch: batch_key,
        raw_stock_quantity: stage.raw_quantity,
        raw_quote_quantity: total_quote
    });
    Ok(())
}

fn verify_requests<'info>(
    ctx: &Context<'info, SettleStage<'info>>,
    inputs: &[RequestExecution],
    now: i64,
) -> Result<Vec<MatchBuyer>> {
    let mut buyers = Vec::with_capacity(inputs.len());
    for (index, terms) in inputs.iter().enumerate() {
        let request_info = &ctx.remaining_accounts[index * 3];
        let escrow_info = &ctx.remaining_accounts[index * 3 + 1];
        let recipient_info = &ctx.remaining_accounts[index * 3 + 2];
        require!(
            request_info.key == &ctx.accounts.batch.requests[index]
                && request_info.is_writable
                && escrow_info.is_writable
                && recipient_info.is_writable,
            BazoError::InvalidBatchSet
        );
        let request: Account<BuyRequest> = Account::try_from(request_info)?;
        let escrow: InterfaceAccount<TokenAccount> = InterfaceAccount::try_from(escrow_info)?;
        let recipient: InterfaceAccount<TokenAccount> = InterfaceAccount::try_from(recipient_info)?;
        require!(
            request.version == BUY_REQUEST_VERSION
                && request.status == STATUS_ACTIVE
                && request.market == ctx.accounts.market.key()
                && request.locked_batch == Some(ctx.accounts.batch.key()),
            BazoError::BuyRequestNotActive
        );
        require!(
            request.expires_at > now && request.created_at < ctx.accounts.batch.window_end,
            BazoError::ExpiredBuyRequest
        );
        let (expected_request, bump) = Pubkey::find_program_address(
            &[
                BUY_REQUEST_SEED,
                &BUY_REQUEST_VERSION.to_le_bytes(),
                request.buyer.as_ref(),
                &request.request_nonce.to_le_bytes(),
            ],
            ctx.program_id,
        );
        require!(
            expected_request == request.key() && bump == request.bump,
            BazoError::InvalidBatchSet
        );
        let (expected_escrow, _) = Pubkey::find_program_address(
            &[BUY_ESCROW_SEED, request.key().as_ref()],
            ctx.program_id,
        );
        require!(
            request.escrow == expected_escrow
                && escrow.key() == expected_escrow
                && escrow_info.owner == &ctx.accounts.quote_token_program.key()
                && escrow.owner == request.key()
                && escrow.mint == ctx.accounts.quote_mint.key(),
            BazoError::EscrowAccountingMismatch
        );
        require!(
            recipient_info.owner == &ctx.accounts.stock_token_program.key()
                && recipient.owner == request.recipient
                && recipient.mint == ctx.accounts.stock_mint.key(),
            BazoError::InvalidStockRecipient
        );
        validate_transfer_account_extensions(escrow_info)?;
        validate_transfer_account_extensions(recipient_info)?;
        let remaining_quote = request
            .max_quote_amount
            .checked_sub(request.spent_quote_amount)
            .ok_or(BazoError::EscrowAccountingMismatch)?;
        require!(
            remaining_quote > 0 && escrow.amount == remaining_quote,
            BazoError::EscrowAccountingMismatch
        );
        let opening = CanonicalBuyRequestOpeningV1 {
            schema_version: COMMITMENT_SCHEMA_VERSION,
            network: DEVNET_NETWORK_ID,
            request: request.key(),
            buyer: request.buyer,
            recipient: request.recipient,
            market: request.market,
            target_raw_quantity: terms.target_raw_quantity,
            max_premium_bps: terms.max_premium_bps,
            max_quote_amount: request.max_quote_amount,
            expires_at: request.expires_at,
            allow_partial_fills: terms.allow_partial_fills,
            request_nonce: request.request_nonce,
            salt: terms.salt,
        };
        require!(
            hash_canonical_buy_request(&opening)? == request.request_commitment,
            BazoError::InvalidBuyRequestCommitment
        );
        let remaining_raw_quantity = terms
            .target_raw_quantity
            .checked_sub(request.filled_raw_quantity)
            .ok_or(BazoError::InvalidBuyRequestCommitment)?;
        require!(
            remaining_raw_quantity > 0,
            BazoError::InvalidBuyRequestCommitment
        );
        buyers.push(MatchBuyer {
            request: request.key(),
            created_slot: request.created_slot,
            remaining_raw_quantity,
            max_premium_bps: terms.max_premium_bps,
            allow_partial_fills: terms.allow_partial_fills,
        });
    }
    Ok(buyers)
}

fn stock_multiplier_bits(mint_info: &AccountInfo<'_>, now: i64) -> Result<u64> {
    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<Token2022Mint>::unpack(&mint_data)
        .map_err(|_| error!(BazoError::UnsupportedMintExtensions))?;
    let config = mint
        .get_extension::<ScaledUiAmountConfig>()
        .map_err(|_| error!(BazoError::UnsupportedMintExtensions))?;
    let effective_at: i64 = config.new_multiplier_effective_timestamp.into();
    let multiplier = if now >= effective_at {
        config.new_multiplier
    } else {
        config.multiplier
    };
    Ok(u64::from_le_bytes(multiplier.0))
}

fn calculate_charges<'info>(
    ctx: &Context<'info, SettleStage<'info>>,
    allocations: &[(Pubkey, u64)],
    premium_bps: i32,
    multiplier_bits: u64,
    price: i64,
    exponent: i16,
) -> Result<([u64; MAX_BATCH_REQUESTS], [u64; MAX_BATCH_REQUESTS], u64)> {
    let mut fills = [0u64; MAX_BATCH_REQUESTS];
    let mut charges = [0u64; MAX_BATCH_REQUESTS];
    let mut total_quote = 0u64;
    for (request_key, raw_fill) in allocations {
        let index = ctx
            .accounts
            .batch
            .requests
            .iter()
            .position(|key| key == request_key)
            .ok_or(BazoError::InvalidBatchSet)?;
        let request: Account<BuyRequest> = Account::try_from(&ctx.remaining_accounts[index * 3])?;
        let charge = quote_charge(
            *raw_fill,
            ctx.accounts.stock_mint.decimals,
            multiplier_bits,
            price,
            exponent,
            premium_bps,
            ctx.accounts.quote_mint.decimals,
        )
        .map_err(|_| error!(BazoError::InvalidQuoteAmount))?;
        let available = request
            .max_quote_amount
            .checked_sub(request.spent_quote_amount)
            .ok_or(BazoError::EscrowAccountingMismatch)?;
        require!(charge <= available, BazoError::InsufficientQuote);
        fills[index] = *raw_fill;
        charges[index] = charge;
        total_quote = total_quote
            .checked_add(charge)
            .ok_or(BazoError::InvalidQuoteAmount)?;
    }
    Ok((fills, charges, total_quote))
}

fn transfer_and_update_requests<'info>(
    ctx: &Context<'info, SettleStage<'info>>,
    inputs: &[RequestExecution],
    fills: &[u64; MAX_BATCH_REQUESTS],
    charges: &[u64; MAX_BATCH_REQUESTS],
) -> Result<()> {
    let plan = &ctx.accounts.plan;
    let plan_signer: &[&[u8]] = &[
        PLAN_SEED,
        &PLAN_VERSION.to_le_bytes(),
        plan.owner.as_ref(),
        &plan.plan_nonce.to_le_bytes(),
        &[plan.bump],
    ];
    for (index, terms) in inputs.iter().enumerate() {
        let request_info = &ctx.remaining_accounts[index * 3];
        let escrow_info = &ctx.remaining_accounts[index * 3 + 1];
        let recipient_info = &ctx.remaining_accounts[index * 3 + 2];
        let mut request: Account<BuyRequest> = Account::try_from(request_info)?;
        if fills[index] > 0 {
            let stock_transfer = TransferChecked {
                from: ctx.accounts.stock_vault.to_account_info(),
                mint: ctx.accounts.stock_mint.to_account_info(),
                to: recipient_info.clone(),
                authority: plan.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.stock_token_program.key(),
                    stock_transfer,
                    &[plan_signer],
                ),
                fills[index],
                ctx.accounts.stock_mint.decimals,
            )?;
            let request_signer: &[&[u8]] = &[
                BUY_REQUEST_SEED,
                &BUY_REQUEST_VERSION.to_le_bytes(),
                request.buyer.as_ref(),
                &request.request_nonce.to_le_bytes(),
                &[request.bump],
            ];
            let quote_transfer = TransferChecked {
                from: escrow_info.clone(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.proceeds_vault.to_account_info(),
                authority: request.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.quote_token_program.key(),
                    quote_transfer,
                    &[request_signer],
                ),
                charges[index],
                ctx.accounts.quote_mint.decimals,
            )?;
            request.filled_raw_quantity = request
                .filled_raw_quantity
                .checked_add(fills[index])
                .ok_or(BazoError::InvalidBuyRequestCommitment)?;
            request.spent_quote_amount = request
                .spent_quote_amount
                .checked_add(charges[index])
                .ok_or(BazoError::EscrowAccountingMismatch)?;
            if request.filled_raw_quantity == terms.target_raw_quantity {
                request.status = BUY_REQUEST_FILLED;
                request.refundable_quote_amount = request
                    .max_quote_amount
                    .checked_sub(request.spent_quote_amount)
                    .ok_or(BazoError::EscrowAccountingMismatch)?;
            }
        }
        request.locked_batch = None;
        request.exit(ctx.program_id)?;
    }
    Ok(())
}
