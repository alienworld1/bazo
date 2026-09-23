use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as Token2022Mint,
};
use solana_sha256_hasher::hashv;

declare_id!("6e35GBMnuKLhWCJe3qmzWuJbN9L6XCTMPvAx5hgXLagb");

pub const PROTOCOL_VERSION: u16 = 1;
pub const PLAN_VERSION: u16 = 1;
pub const COMMITMENT_SCHEMA_VERSION: u16 = 1;
pub const DEVNET_NETWORK_ID: u8 = 1;
pub const STATUS_ACTIVE: u8 = 1;
pub const BUY_REQUEST_VERSION: u16 = 1;
pub const STATUS_CANCELED: u8 = 2;
pub const STATUS_EXPIRED: u8 = 3;
pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";
pub const MARKET_SEED: &[u8] = b"market";
pub const PLAN_SEED: &[u8] = b"plan";
pub const STOCK_VAULT_SEED: &[u8] = b"plan-stock-vault";
pub const PROCEEDS_VAULT_SEED: &[u8] = b"plan-proceeds-vault";
pub const DEVNET_STOCK_FAUCET_SEED: &[u8] = b"devnet-stock-faucet";
pub const DEVNET_STOCK_CLAIM_SEED: &[u8] = b"devnet-stock-claim";
pub const BUY_REQUEST_SEED: &[u8] = b"buy-request";
pub const BUY_ESCROW_SEED: &[u8] = b"buy-escrow";
pub const BATCH_SEED: &[u8] = b"batch";
pub const BATCH_POLICY_SEED: &[u8] = b"batch-policy";
pub const BATCH_VERSION: u16 = 1;
pub const MAX_BATCH_REQUESTS: usize = 4;
pub const BATCH_OPEN: u8 = 1;
pub const BATCH_LOCKED: u8 = 2;
pub const BATCH_EXPIRED: u8 = 3;
pub const BUY_REQUEST_DOMAIN: &[u8] = b"BAZO_BUY_REQUEST_V1";
pub const TERMINAL_DOMAIN: &[u8] = b"BAZO_STAGE_TERMINAL_V1";
pub const SCALED_UI_AMOUNT_EXTENSION_POLICY: u32 = 1;
pub const DEVNET_STOCK_CLAIM_RAW_AMOUNT: u64 = 10_000_000;

#[program]
pub mod bazo {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        let protocol_config = &mut ctx.accounts.protocol_config;
        protocol_config.version = PROTOCOL_VERSION;
        protocol_config.authority = ctx.accounts.authority.key();
        protocol_config.bump = ctx.bumps.protocol_config;

        emit!(ProtocolInitialized {
            protocol_config: protocol_config.key(),
            authority: protocol_config.authority,
            version: protocol_config.version,
        });

        Ok(())
    }

    pub fn create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
        require!(args.allowed_session_mask != 0, BazoError::InvalidSessionMask);
        require!(args.max_reference_age_seconds > 0, BazoError::InvalidReferenceAge);
        require!(args.minimum_stage_raw_amount > 0, BazoError::InvalidMinimumStageAmount);
        require!(
            args.supported_stock_extensions == SCALED_UI_AMOUNT_EXTENSION_POLICY,
            BazoError::UnsupportedMintExtensions
        );
        validate_stock_mint_extensions(&ctx.accounts.stock_mint.to_account_info())?;

        let market = &mut ctx.accounts.market;
        market.version = PLAN_VERSION;
        market.authority = ctx.accounts.authority.key();
        market.stock_mint = ctx.accounts.stock_mint.key();
        market.stock_token_program = ctx.accounts.stock_token_program.key();
        market.quote_mint = ctx.accounts.quote_mint.key();
        market.quote_token_program = ctx.accounts.quote_token_program.key();
        market.pyth_feed_id = args.pyth_feed_id;
        market.allowed_session_mask = args.allowed_session_mask;
        market.max_reference_age_seconds = args.max_reference_age_seconds;
        market.minimum_stage_raw_amount = args.minimum_stage_raw_amount;
        market.supported_stock_extensions = args.supported_stock_extensions;
        market.enabled = true;
        market.bump = ctx.bumps.market;

        emit!(MarketCreated {
            market: market.key(),
            stock_mint: market.stock_mint,
            quote_mint: market.quote_mint,
            pyth_feed_id: market.pyth_feed_id,
        });

        Ok(())
    }

    pub fn create_plan(ctx: Context<CreatePlan>, args: CreatePlanArgs) -> Result<()> {
        require!(args.commitment_schema_version == COMMITMENT_SCHEMA_VERSION, BazoError::UnsupportedCommitmentSchema);
        require!(args.initial_raw_inventory > 0, BazoError::InvalidInventoryAmount);
        require!(args.expires_at > Clock::get()?.unix_timestamp, BazoError::ExpiredPlan);
        require!(!is_zero_commitment(&args.current_stage_commitment), BazoError::InvalidCommitment);

        let terminal_commitment = terminal_commitment(ctx.accounts.plan.key(), ctx.accounts.market.key());
        require!(args.current_stage_commitment != terminal_commitment, BazoError::InvalidCommitment);

        let market = &ctx.accounts.market;
        require!(market.enabled, BazoError::MarketDisabled);
        require!(market.stock_mint == ctx.accounts.stock_mint.key(), BazoError::MarketMismatch);
        require!(market.stock_token_program == ctx.accounts.stock_token_program.key(), BazoError::MarketMismatch);
        require!(market.quote_mint == ctx.accounts.quote_mint.key(), BazoError::MarketMismatch);
        require!(market.quote_token_program == ctx.accounts.quote_token_program.key(), BazoError::MarketMismatch);
        require!(args.initial_raw_inventory >= market.minimum_stage_raw_amount, BazoError::InvalidInventoryAmount);
        require!(ctx.accounts.owner_stock_account.amount >= args.initial_raw_inventory, BazoError::InsufficientStock);
        require!(
            market.supported_stock_extensions == SCALED_UI_AMOUNT_EXTENSION_POLICY,
            BazoError::UnsupportedMintExtensions
        );
        validate_stock_mint_extensions(&ctx.accounts.stock_mint.to_account_info())?;

        let plan = &mut ctx.accounts.plan;
        plan.version = PLAN_VERSION;
        plan.owner = ctx.accounts.owner.key();
        plan.market = market.key();
        plan.stock_vault = ctx.accounts.stock_vault.key();
        plan.proceeds_vault = ctx.accounts.proceeds_vault.key();
        plan.initial_raw_inventory = args.initial_raw_inventory;
        plan.remaining_raw_inventory = args.initial_raw_inventory;
        plan.sold_raw_inventory = 0;
        plan.quote_proceeds_accrued = 0;
        plan.quote_proceeds_claimed = 0;
        plan.current_stage_index = 0;
        plan.current_stage_commitment = args.current_stage_commitment;
        plan.status = STATUS_ACTIVE;
        plan.created_at = Clock::get()?.unix_timestamp;
        plan.expires_at = args.expires_at;
        plan.plan_nonce = args.plan_nonce;
        plan.bump = ctx.bumps.plan;

        let transfer_accounts = TransferChecked {
            from: ctx.accounts.owner_stock_account.to_account_info(),
            mint: ctx.accounts.stock_mint.to_account_info(),
            to: ctx.accounts.stock_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.stock_token_program.key(), transfer_accounts),
            args.initial_raw_inventory,
            ctx.accounts.stock_mint.decimals,
        )?;

        emit!(PlanCreated {
            plan: plan.key(),
            owner: plan.owner,
            market: plan.market,
            stock_vault: plan.stock_vault,
            proceeds_vault: plan.proceeds_vault,
            raw_funded_amount: plan.initial_raw_inventory,
            expires_at: plan.expires_at,
            commitment_schema_version: args.commitment_schema_version,
            current_stage_commitment: plan.current_stage_commitment,
        });

        Ok(())
    }

    pub fn claim_devnet_stock(ctx: Context<ClaimDevnetStock>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.enabled, BazoError::MarketDisabled);
        require!(
            market.supported_stock_extensions == SCALED_UI_AMOUNT_EXTENSION_POLICY,
            BazoError::UnsupportedMintExtensions
        );
        validate_stock_mint_extensions(&ctx.accounts.stock_mint.to_account_info())?;
        require!(
            ctx.accounts.stock_mint.mint_authority
                == Some(ctx.accounts.faucet_authority.key()).into(),
            BazoError::InvalidFaucetAuthority
        );

        let claim = &mut ctx.accounts.claim;
        claim.version = PROTOCOL_VERSION;
        claim.recipient = ctx.accounts.recipient.key();
        claim.market = market.key();
        claim.raw_amount = DEVNET_STOCK_CLAIM_RAW_AMOUNT;
        claim.claimed_at = Clock::get()?.unix_timestamp;
        claim.bump = ctx.bumps.claim;

        let market_key = market.key();
        let signer_seeds: &[&[u8]] = &[
            DEVNET_STOCK_FAUCET_SEED,
            market_key.as_ref(),
            &[ctx.bumps.faucet_authority],
        ];
        let mint_accounts = MintTo {
            mint: ctx.accounts.stock_mint.to_account_info(),
            to: ctx.accounts.recipient_stock_account.to_account_info(),
            authority: ctx.accounts.faucet_authority.to_account_info(),
        };
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.stock_token_program.key(),
                mint_accounts,
                &[signer_seeds],
            ),
            DEVNET_STOCK_CLAIM_RAW_AMOUNT,
        )?;

        emit!(DevnetStockClaimed {
            recipient: claim.recipient,
            market: claim.market,
            recipient_stock_account: ctx.accounts.recipient_stock_account.key(),
            raw_amount: claim.raw_amount,
        });

        Ok(())
    }

    pub fn create_buy_request(ctx: Context<CreateBuyRequest>, args: CreateBuyRequestArgs) -> Result<()> {
        require!(args.commitment_schema_version == COMMITMENT_SCHEMA_VERSION, BazoError::UnsupportedCommitmentSchema);
        require!(args.max_quote_amount > 0, BazoError::InvalidQuoteAmount);
        require!(args.expires_at > Clock::get()?.unix_timestamp, BazoError::ExpiredBuyRequest);
        require!(!is_zero_commitment(&args.request_commitment), BazoError::InvalidBuyRequestCommitment);
        let market = &ctx.accounts.market;
        require!(market.enabled, BazoError::MarketDisabled);
        require!(market.stock_mint == ctx.accounts.stock_mint.key(), BazoError::MarketMismatch);
        require!(market.stock_token_program == ctx.accounts.stock_token_program.key(), BazoError::MarketMismatch);
        require!(market.quote_mint == ctx.accounts.quote_mint.key(), BazoError::MarketMismatch);
        require!(market.quote_token_program == ctx.accounts.quote_token_program.key(), BazoError::MarketMismatch);
        require!(ctx.accounts.buyer_quote_account.amount >= args.max_quote_amount, BazoError::InsufficientQuote);
        validate_quote_mint_extensions(&ctx.accounts.quote_mint.to_account_info())?;

        let request = &mut ctx.accounts.request;
        request.version = BUY_REQUEST_VERSION;
        request.buyer = ctx.accounts.buyer.key();
        request.recipient = args.recipient;
        request.market = market.key();
        request.escrow = ctx.accounts.escrow.key();
        request.request_commitment = args.request_commitment;
        request.max_quote_amount = args.max_quote_amount;
        request.spent_quote_amount = 0;
        request.refundable_quote_amount = 0;
        request.filled_raw_quantity = 0;
        request.expires_at = args.expires_at;
        request.created_at = Clock::get()?.unix_timestamp;
        request.created_slot = Clock::get()?.slot;
        request.request_nonce = args.request_nonce;
        request.locked_batch = None;
        request.status = STATUS_ACTIVE;
        request.bump = ctx.bumps.request;

        let transfer_accounts = TransferChecked {
            from: ctx.accounts.buyer_quote_account.to_account_info(),
            mint: ctx.accounts.quote_mint.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.quote_token_program.key(), transfer_accounts),
            args.max_quote_amount,
            ctx.accounts.quote_mint.decimals,
        )?;
        emit!(BuyRequestCreated { request: request.key(), buyer: request.buyer, recipient: request.recipient, market: request.market, escrow: request.escrow, max_quote_amount: request.max_quote_amount, expires_at: request.expires_at, request_commitment: request.request_commitment });
        Ok(())
    }

    pub fn cancel_buy_request(ctx: Context<CancelBuyRequest>) -> Result<()> {
        let request = &mut ctx.accounts.request;
        require!(request.status == STATUS_ACTIVE, BazoError::BuyRequestNotActive);
        require!(request.locked_batch.is_none(), BazoError::BuyRequestLocked);
        require!(request.buyer == ctx.accounts.buyer.key(), BazoError::Unauthorized);
        let refundable = request.max_quote_amount.checked_sub(request.spent_quote_amount).ok_or(BazoError::EscrowAccountingMismatch)?;
        require!(ctx.accounts.escrow.amount == refundable, BazoError::EscrowAccountingMismatch);
        request.status = STATUS_CANCELED;
        request.refundable_quote_amount = 0;
        let request_key = request.key();
        let signer_seeds: &[&[u8]] = &[BUY_REQUEST_SEED, &BUY_REQUEST_VERSION.to_le_bytes(), request.buyer.as_ref(), &request.request_nonce.to_le_bytes(), &[request.bump]];
        let transfer_accounts = TransferChecked { from: ctx.accounts.escrow.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.buyer_quote_destination.to_account_info(), authority: request.to_account_info() };
        token_interface::transfer_checked(CpiContext::new_with_signer(ctx.accounts.quote_token_program.key(), transfer_accounts, &[signer_seeds]), refundable, ctx.accounts.quote_mint.decimals)?;
        emit!(BuyRequestCanceled { request: request_key, buyer: request.buyer, refunded_quote_amount: refundable });
        Ok(())
    }

    pub fn refund_buy_request(ctx: Context<CancelBuyRequest>) -> Result<()> {
        let request = &mut ctx.accounts.request;
        require!(request.status == STATUS_ACTIVE, BazoError::BuyRequestNotActive);
        require!(request.locked_batch.is_none(), BazoError::BuyRequestLocked);
        require!(Clock::get()?.unix_timestamp >= request.expires_at, BazoError::BuyRequestNotExpired);
        let refundable = request.max_quote_amount.checked_sub(request.spent_quote_amount).ok_or(BazoError::EscrowAccountingMismatch)?;
        require!(refundable > 0 && ctx.accounts.escrow.amount == refundable, BazoError::EscrowAccountingMismatch);
        request.status = STATUS_EXPIRED;
        request.refundable_quote_amount = 0;
        let signer_seeds: &[&[u8]] = &[BUY_REQUEST_SEED, &BUY_REQUEST_VERSION.to_le_bytes(), request.buyer.as_ref(), &request.request_nonce.to_le_bytes(), &[request.bump]];
        let transfer_accounts = TransferChecked { from: ctx.accounts.escrow.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.buyer_quote_destination.to_account_info(), authority: request.to_account_info() };
        token_interface::transfer_checked(CpiContext::new_with_signer(ctx.accounts.quote_token_program.key(), transfer_accounts, &[signer_seeds]), refundable, ctx.accounts.quote_mint.decimals)?;
        emit!(BuyRequestRefunded { request: request.key(), buyer: request.buyer, refunded_quote_amount: refundable });
        Ok(())
    }

    pub fn open_batch(ctx: Context<OpenBatch>, window_start: i64) -> Result<()> {
        let clock = Clock::get()?;
        let policy = &ctx.accounts.policy;
        require!(clock.unix_timestamp.div_euclid(policy.window_seconds) * policy.window_seconds == window_start, BazoError::InvalidBatchWindow);
        let batch = &mut ctx.accounts.batch;
        batch.version = BATCH_VERSION;
        batch.market = ctx.accounts.market.key();
        batch.window_start = window_start;
        batch.window_end = window_start.checked_add(policy.window_seconds).ok_or(BazoError::InvalidBatchWindow)?;
        batch.window_seconds = policy.window_seconds;
        batch.lock_seconds = policy.lock_seconds;
        batch.created_slot = clock.slot;
        batch.lock_slot = None;
        batch.lock_deadline = batch.window_end.checked_add(policy.lock_seconds).ok_or(BazoError::InvalidBatchWindow)?;
        batch.status = BATCH_OPEN;
        batch.requests = Vec::new();
        batch.bump = ctx.bumps.batch;
        emit!(BatchOpened { batch: batch.key(), market: batch.market, window_start, window_end: batch.window_end });
        Ok(())
    }

    pub fn initialize_batch_policy(ctx: Context<InitializeBatchPolicy>, window_seconds: i64, lock_seconds: i64) -> Result<()> {
        require!((30..=60).contains(&window_seconds) && (60..=300).contains(&lock_seconds), BazoError::InvalidBatchWindow);
        let policy = &mut ctx.accounts.policy;
        policy.version = BATCH_VERSION;
        policy.market = ctx.accounts.market.key();
        policy.window_seconds = window_seconds;
        policy.lock_seconds = lock_seconds;
        policy.bump = ctx.bumps.policy;
        emit!(BatchPolicyInitialized { market: policy.market, window_seconds, lock_seconds });
        Ok(())
    }

    pub fn lock_batch(ctx: Context<LockBatch>, request_keys: Vec<Pubkey>) -> Result<()> {
        let clock = Clock::get()?;
        let batch = &mut ctx.accounts.batch;
        require!(batch.status == BATCH_OPEN, BazoError::BatchNotOpen);
        require!(clock.unix_timestamp >= batch.window_end && clock.unix_timestamp < batch.lock_deadline, BazoError::BatchWindowEnded);
        require!(!request_keys.is_empty() && request_keys.len() <= MAX_BATCH_REQUESTS, BazoError::InvalidBatchSet);
        require!(ctx.remaining_accounts.len() == request_keys.len() * 2, BazoError::InvalidBatchSet);
        require!(request_keys.windows(2).all(|pair| pair[0].to_bytes() < pair[1].to_bytes()), BazoError::InvalidBatchSet);
        for (index, key) in request_keys.iter().enumerate() {
            let request_info = &ctx.remaining_accounts[index * 2];
            let escrow_info = &ctx.remaining_accounts[index * 2 + 1];
            require!(request_info.key == key && request_info.is_writable, BazoError::InvalidBatchSet);
            let mut request: Account<BuyRequest> = Account::try_from(request_info)?;
            let escrow: InterfaceAccount<TokenAccount> = InterfaceAccount::try_from(escrow_info)?;
            require!(request.version == BUY_REQUEST_VERSION && request.market == batch.market && request.status == STATUS_ACTIVE, BazoError::BuyRequestNotActive);
            require!(request.created_at < batch.window_end && request.expires_at > batch.lock_deadline, BazoError::ExpiredBuyRequest);
            require!(request.locked_batch.is_none(), BazoError::BuyRequestLocked);
            require!(request.escrow == *escrow_info.key && escrow.mint == ctx.accounts.market.quote_mint && escrow.owner == *request_info.key && escrow_info.owner == &ctx.accounts.market.quote_token_program, BazoError::EscrowAccountingMismatch);
            let remaining = request.max_quote_amount.checked_sub(request.spent_quote_amount).ok_or(BazoError::EscrowAccountingMismatch)?;
            require!(remaining > 0 && escrow.amount == remaining, BazoError::EscrowAccountingMismatch);
            request.locked_batch = Some(batch.key());
            request.exit(ctx.program_id)?;
        }
        batch.requests = request_keys;
        batch.lock_slot = Some(clock.slot);
        batch.status = BATCH_LOCKED;
        emit!(BatchLocked { batch: batch.key(), request_count: batch.requests.len() as u8, lock_deadline: batch.lock_deadline });
        Ok(())
    }

    pub fn expire_batch(ctx: Context<ExpireBatch>) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        require!(batch.status == BATCH_OPEN || batch.status == BATCH_LOCKED, BazoError::BatchAlreadyEnded);
        require!(Clock::get()?.unix_timestamp >= batch.lock_deadline, BazoError::BatchNotExpired);
        require!(ctx.remaining_accounts.len() == batch.requests.len(), BazoError::InvalidBatchSet);
        for (index, key) in batch.requests.iter().enumerate() {
            let info = &ctx.remaining_accounts[index];
            require!(info.key == key && info.is_writable, BazoError::InvalidBatchSet);
            let mut request: Account<BuyRequest> = Account::try_from(info)?;
            require!(request.locked_batch == Some(batch.key()), BazoError::InvalidBatchSet);
            request.locked_batch = None;
            request.exit(ctx.program_id)?;
        }
        batch.status = BATCH_EXPIRED;
        emit!(BatchExpired { batch: batch.key() });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(window_start: i64)]
pub struct OpenBatch<'info> {
    #[account(mut)] pub caller: Signer<'info>,
    #[account(constraint = market.enabled @ BazoError::MarketDisabled)] pub market: Account<'info, Market>,
    #[account(has_one = market @ BazoError::MarketMismatch, seeds = [BATCH_POLICY_SEED, market.key().as_ref()], bump = policy.bump)] pub policy: Account<'info, BatchPolicy>,
    #[account(init, payer = caller, space = 8 + Batch::INIT_SPACE, seeds = [BATCH_SEED, &BATCH_VERSION.to_le_bytes(), market.key().as_ref(), &window_start.to_le_bytes()], bump)] pub batch: Account<'info, Batch>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeBatchPolicy<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(has_one = authority @ BazoError::Unauthorized)] pub market: Account<'info, Market>,
    #[account(init, payer = authority, space = 8 + BatchPolicy::INIT_SPACE, seeds = [BATCH_POLICY_SEED, market.key().as_ref()], bump)] pub policy: Account<'info, BatchPolicy>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockBatch<'info> {
    pub caller: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, has_one = market @ BazoError::MarketMismatch, seeds = [BATCH_SEED, &BATCH_VERSION.to_le_bytes(), market.key().as_ref(), &batch.window_start.to_le_bytes()], bump = batch.bump)] pub batch: Account<'info, Batch>,
}

#[derive(Accounts)]
pub struct ExpireBatch<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [BATCH_SEED, &BATCH_VERSION.to_le_bytes(), batch.market.as_ref(), &batch.window_start.to_le_bytes()], bump = batch.bump)] pub batch: Account<'info, Batch>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMarketArgs {
    pub pyth_feed_id: u64,
    pub allowed_session_mask: u8,
    pub max_reference_age_seconds: u32,
    pub minimum_stage_raw_amount: u64,
    pub supported_stock_extensions: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePlanArgs {
    pub plan_nonce: u64,
    pub current_stage_commitment: [u8; 32],
    pub initial_raw_inventory: u64,
    pub expires_at: i64,
    pub commitment_schema_version: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateBuyRequestArgs {
    pub request_nonce: u64,
    pub request_commitment: [u8; 32],
    pub max_quote_amount: u64,
    pub expires_at: i64,
    pub recipient: Pubkey,
    pub commitment_schema_version: u16,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut, has_one = authority @ BazoError::Unauthorized)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub stock_mint: InterfaceAccount<'info, Mint>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(address = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub stock_token_program: Interface<'info, TokenInterface>,
    #[account(address = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub quote_token_program: Interface<'info, TokenInterface>,
    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, stock_mint.key().as_ref(), quote_mint.key().as_ref()],
        bump,
    )]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: CreatePlanArgs)]
pub struct CreatePlan<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        has_one = stock_mint @ BazoError::MarketMismatch,
        has_one = quote_mint @ BazoError::MarketMismatch,
        constraint = market.enabled @ BazoError::MarketDisabled,
    )]
    pub market: Account<'info, Market>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub stock_mint: InterfaceAccount<'info, Mint>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(
        address = market.stock_token_program @ BazoError::MarketMismatch,
        constraint = stock_token_program.key() == anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram,
    )]
    pub stock_token_program: Interface<'info, TokenInterface>,
    #[account(
        address = market.quote_token_program @ BazoError::MarketMismatch,
        constraint = quote_token_program.key() == anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram,
    )]
    pub quote_token_program: Interface<'info, TokenInterface>,
    #[account(
        mut,
        constraint = owner_stock_account.owner == owner.key() @ BazoError::InvalidStockSource,
        constraint = owner_stock_account.mint == stock_mint.key() @ BazoError::InvalidStockSource,
        constraint = owner_stock_account.to_account_info().owner == &stock_token_program.key() @ BazoError::InvalidStockSource,
    )]
    pub owner_stock_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        space = 8 + Plan::INIT_SPACE,
        seeds = [PLAN_SEED, &PLAN_VERSION.to_le_bytes(), owner.key().as_ref(), &args.plan_nonce.to_le_bytes()],
        bump,
    )]
    pub plan: Account<'info, Plan>,
    #[account(
        init,
        payer = owner,
        seeds = [STOCK_VAULT_SEED, plan.key().as_ref()],
        bump,
        token::mint = stock_mint,
        token::authority = plan,
        token::token_program = stock_token_program,
    )]
    pub stock_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        seeds = [PROCEEDS_VAULT_SEED, plan.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = plan,
        token::token_program = quote_token_program,
    )]
    pub proceeds_vault: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimDevnetStock<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,
    #[account(
        has_one = stock_mint @ BazoError::MarketMismatch,
        constraint = market.enabled @ BazoError::MarketDisabled,
    )]
    pub market: Account<'info, Market>,
    #[account(mut, owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
    pub stock_mint: InterfaceAccount<'info, Mint>,
    #[account(
        address = market.stock_token_program @ BazoError::MarketMismatch,
        constraint = stock_token_program.key() == anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram,
    )]
    pub stock_token_program: Interface<'info, TokenInterface>,
    #[account(
        mut,
        constraint = recipient_stock_account.owner == recipient.key() @ BazoError::InvalidClaimDestination,
        constraint = recipient_stock_account.mint == stock_mint.key() @ BazoError::InvalidClaimDestination,
        constraint = recipient_stock_account.to_account_info().owner == &stock_token_program.key() @ BazoError::InvalidClaimDestination,
    )]
    pub recipient_stock_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: This PDA is the configured mint authority and signs the Token-2022 CPI.
    #[account(
        seeds = [DEVNET_STOCK_FAUCET_SEED, market.key().as_ref()],
        bump,
    )]
    pub faucet_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = recipient,
        space = 8 + DevnetStockClaim::INIT_SPACE,
        seeds = [DEVNET_STOCK_CLAIM_SEED, market.key().as_ref(), recipient.key().as_ref()],
        bump,
    )]
    pub claim: Account<'info, DevnetStockClaim>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: CreateBuyRequestArgs)]
pub struct CreateBuyRequest<'info> {
    #[account(mut)] pub buyer: Signer<'info>,
    #[account(has_one = stock_mint @ BazoError::MarketMismatch, has_one = quote_mint @ BazoError::MarketMismatch, constraint = market.enabled @ BazoError::MarketDisabled, seeds = [MARKET_SEED, stock_mint.key().as_ref(), quote_mint.key().as_ref()], bump = market.bump)] pub market: Account<'info, Market>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)] pub stock_mint: InterfaceAccount<'info, Mint>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)] pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(address = market.stock_token_program @ BazoError::MarketMismatch, constraint = stock_token_program.key() == anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)] pub stock_token_program: Interface<'info, TokenInterface>,
    #[account(address = market.quote_token_program @ BazoError::MarketMismatch, constraint = quote_token_program.key() == anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)] pub quote_token_program: Interface<'info, TokenInterface>,
    #[account(mut, constraint = buyer_quote_account.owner == buyer.key() @ BazoError::InvalidQuoteSource, constraint = buyer_quote_account.mint == quote_mint.key() @ BazoError::InvalidQuoteSource, constraint = buyer_quote_account.to_account_info().owner == &quote_token_program.key() @ BazoError::InvalidQuoteSource)] pub buyer_quote_account: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = recipient_stock_account.owner == args.recipient @ BazoError::InvalidStockRecipient, constraint = recipient_stock_account.mint == stock_mint.key() @ BazoError::InvalidStockRecipient, constraint = recipient_stock_account.to_account_info().owner == &stock_token_program.key() @ BazoError::InvalidStockRecipient)] pub recipient_stock_account: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = buyer, space = 8 + BuyRequest::INIT_SPACE, seeds = [BUY_REQUEST_SEED, &BUY_REQUEST_VERSION.to_le_bytes(), buyer.key().as_ref(), &args.request_nonce.to_le_bytes()], bump)] pub request: Account<'info, BuyRequest>,
    #[account(init, payer = buyer, seeds = [BUY_ESCROW_SEED, request.key().as_ref()], bump, token::mint = quote_mint, token::authority = request, token::token_program = quote_token_program)] pub escrow: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelBuyRequest<'info> {
    #[account(mut)] pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer @ BazoError::Unauthorized, has_one = market @ BazoError::MarketMismatch, has_one = escrow @ BazoError::MarketMismatch)] pub request: Account<'info, BuyRequest>,
    #[account(has_one = quote_mint @ BazoError::MarketMismatch)] pub market: Account<'info, Market>,
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)] pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(address = market.quote_token_program @ BazoError::MarketMismatch)] pub quote_token_program: Interface<'info, TokenInterface>,
    #[account(mut, constraint = escrow.mint == quote_mint.key() @ BazoError::MarketMismatch, constraint = escrow.owner == request.key() @ BazoError::MarketMismatch)] pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = buyer_quote_destination.owner == buyer.key() @ BazoError::InvalidQuoteDestination, constraint = buyer_quote_destination.mint == quote_mint.key() @ BazoError::InvalidQuoteDestination, constraint = buyer_quote_destination.to_account_info().owner == &quote_token_program.key() @ BazoError::InvalidQuoteDestination)] pub buyer_quote_destination: InterfaceAccount<'info, TokenAccount>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub version: u16,
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub version: u16,
    pub authority: Pubkey,
    pub stock_mint: Pubkey,
    pub stock_token_program: Pubkey,
    pub quote_mint: Pubkey,
    pub quote_token_program: Pubkey,
    pub pyth_feed_id: u64,
    pub allowed_session_mask: u8,
    pub max_reference_age_seconds: u32,
    pub minimum_stage_raw_amount: u64,
    pub supported_stock_extensions: u32,
    pub enabled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Plan {
    pub version: u16,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub stock_vault: Pubkey,
    pub proceeds_vault: Pubkey,
    pub initial_raw_inventory: u64,
    pub remaining_raw_inventory: u64,
    pub sold_raw_inventory: u64,
    pub quote_proceeds_accrued: u64,
    pub quote_proceeds_claimed: u64,
    pub current_stage_index: u16,
    pub current_stage_commitment: [u8; 32],
    pub status: u8,
    pub created_at: i64,
    pub expires_at: i64,
    pub plan_nonce: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DevnetStockClaim {
    pub version: u16,
    pub recipient: Pubkey,
    pub market: Pubkey,
    pub raw_amount: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BuyRequest {
    pub version: u16,
    pub buyer: Pubkey,
    pub recipient: Pubkey,
    pub market: Pubkey,
    pub escrow: Pubkey,
    pub request_commitment: [u8; 32],
    pub max_quote_amount: u64,
    pub spent_quote_amount: u64,
    pub refundable_quote_amount: u64,
    pub filled_raw_quantity: u64,
    pub expires_at: i64,
    pub created_at: i64,
    pub created_slot: u64,
    pub request_nonce: u64,
    pub locked_batch: Option<Pubkey>,
    pub status: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Batch {
    pub version: u16,
    pub market: Pubkey,
    pub window_start: i64,
    pub window_end: i64,
    pub window_seconds: i64,
    pub lock_seconds: i64,
    pub created_slot: u64,
    pub lock_slot: Option<u64>,
    pub lock_deadline: i64,
    pub status: u8,
    #[max_len(4)]
    pub requests: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BatchPolicy {
    pub version: u16,
    pub market: Pubkey,
    pub window_seconds: i64,
    pub lock_seconds: i64,
    pub bump: u8,
}

#[event]
pub struct ProtocolInitialized {
    pub protocol_config: Pubkey,
    pub authority: Pubkey,
    pub version: u16,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub stock_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pyth_feed_id: u64,
}

#[event]
pub struct PlanCreated {
    pub plan: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub stock_vault: Pubkey,
    pub proceeds_vault: Pubkey,
    pub raw_funded_amount: u64,
    pub expires_at: i64,
    pub commitment_schema_version: u16,
    pub current_stage_commitment: [u8; 32],
}

#[event]
pub struct DevnetStockClaimed {
    pub recipient: Pubkey,
    pub market: Pubkey,
    pub recipient_stock_account: Pubkey,
    pub raw_amount: u64,
}

#[event]
pub struct BuyRequestCreated { pub request: Pubkey, pub buyer: Pubkey, pub recipient: Pubkey, pub market: Pubkey, pub escrow: Pubkey, pub max_quote_amount: u64, pub expires_at: i64, pub request_commitment: [u8; 32] }
#[event]
pub struct BuyRequestCanceled { pub request: Pubkey, pub buyer: Pubkey, pub refunded_quote_amount: u64 }
#[event]
pub struct BuyRequestRefunded { pub request: Pubkey, pub buyer: Pubkey, pub refunded_quote_amount: u64 }
#[event]
pub struct BatchOpened { pub batch: Pubkey, pub market: Pubkey, pub window_start: i64, pub window_end: i64 }
#[event]
pub struct BatchLocked { pub batch: Pubkey, pub request_count: u8, pub lock_deadline: i64 }
#[event]
pub struct BatchExpired { pub batch: Pubkey }
#[event]
pub struct BatchPolicyInitialized { pub market: Pubkey, pub window_seconds: i64, pub lock_seconds: i64 }

#[error_code]
pub enum BazoError {
    #[msg("The protocol authority did not authorize this operation.")]
    Unauthorized,
    #[msg("The Market configuration does not match the provided accounts.")]
    MarketMismatch,
    #[msg("This Market is not enabled.")]
    MarketDisabled,
    #[msg("The session policy is invalid.")]
    InvalidSessionMask,
    #[msg("The reference age policy is invalid.")]
    InvalidReferenceAge,
    #[msg("The minimum Stage amount is invalid.")]
    InvalidMinimumStageAmount,
    #[msg("The commitment schema is not supported.")]
    UnsupportedCommitmentSchema,
    #[msg("The funded inventory amount is invalid.")]
    InvalidInventoryAmount,
    #[msg("The Sell Plan expiry must be in the future.")]
    ExpiredPlan,
    #[msg("The commitment is not valid for a Sell Plan.")]
    InvalidCommitment,
    #[msg("The stock source account is invalid.")]
    InvalidStockSource,
    #[msg("The stock source account does not have enough balance.")]
    InsufficientStock,
    #[msg("Only Token-2022 mints and token programs are supported.")]
    UnsupportedTokenProgram,
    #[msg("The stock mint does not have the required Token-2022 extensions.")]
    UnsupportedMintExtensions,
    #[msg("The Devnet stock faucet authority does not match the configured mint authority.")]
    InvalidFaucetAuthority,
    #[msg("The Devnet stock claim destination is invalid.")]
    InvalidClaimDestination,
    #[msg("The quote amount is invalid.")] InvalidQuoteAmount,
    #[msg("The quote source account is invalid.")] InvalidQuoteSource,
    #[msg("The quote destination account is invalid.")] InvalidQuoteDestination,
    #[msg("The stock recipient account is invalid.")] InvalidStockRecipient,
    #[msg("The quote source account does not have enough balance.")] InsufficientQuote,
    #[msg("The Buy Request expiry must be in the future.")] ExpiredBuyRequest,
    #[msg("The Buy Request commitment is invalid.")] InvalidBuyRequestCommitment,
    #[msg("The Buy Request is not active.")] BuyRequestNotActive,
    #[msg("The Buy Request is locked for matching.")] BuyRequestLocked,
    #[msg("The Buy Request has not expired yet.")] BuyRequestNotExpired,
    #[msg("The escrow accounting does not match the token balance.")] EscrowAccountingMismatch,
    #[msg("The Batch window is invalid.")] InvalidBatchWindow,
    #[msg("The Batch request set is invalid.")] InvalidBatchSet,
    #[msg("The Batch is not open.")] BatchNotOpen,
    #[msg("The Batch window has ended.")] BatchWindowEnded,
    #[msg("The Batch has already ended.")] BatchAlreadyEnded,
    #[msg("The Batch lock has not expired.")] BatchNotExpired,
}

fn validate_stock_mint_extensions(stock_mint: &AccountInfo<'_>) -> Result<()> {
    let mint_data = stock_mint.try_borrow_data()?;
    let mint = StateWithExtensions::<Token2022Mint>::unpack(&mint_data)
        .map_err(|_| error!(BazoError::UnsupportedMintExtensions))?;
    let extensions = mint
        .get_extension_types()
        .map_err(|_| error!(BazoError::UnsupportedMintExtensions))?;

    require!(
        stock_extensions_are_supported(&extensions),
        BazoError::UnsupportedMintExtensions
    );

    Ok(())
}

fn stock_extensions_are_supported(extensions: &[ExtensionType]) -> bool {
    extensions == [ExtensionType::ScaledUiAmount]
}

fn validate_quote_mint_extensions(quote_mint: &AccountInfo<'_>) -> Result<()> {
    let mint_data = quote_mint.try_borrow_data()?;
    let mint = StateWithExtensions::<Token2022Mint>::unpack(&mint_data).map_err(|_| error!(BazoError::UnsupportedMintExtensions))?;
    let extensions = mint.get_extension_types().map_err(|_| error!(BazoError::UnsupportedMintExtensions))?;
    require!(extensions.is_empty(), BazoError::UnsupportedMintExtensions);
    Ok(())
}

pub fn terminal_commitment(plan: Pubkey, market: Pubkey) -> [u8; 32] {
    hashv(&[
        TERMINAL_DOMAIN,
        &[DEVNET_NETWORK_ID],
        plan.as_ref(),
        market.as_ref(),
    ])
    .to_bytes()
}

pub fn encode_canonical_stage(stage: &CanonicalStageV1) -> Result<Vec<u8>> {
    require!(stage.schema_version == COMMITMENT_SCHEMA_VERSION, BazoError::UnsupportedCommitmentSchema);
    require!(stage.network == DEVNET_NETWORK_ID, BazoError::InvalidCommitment);
    require!(stage.raw_quantity > 0, BazoError::InvalidInventoryAmount);
    require!(stage.allowed_session_mask > 0 && stage.allowed_session_mask <= 15, BazoError::InvalidSessionMask);
    require!(stage.max_reference_age_seconds > 0, BazoError::InvalidReferenceAge);

    let mut bytes = Vec::with_capacity(163);
    bytes.extend_from_slice(b"BAZO_STAGE_V1");
    bytes.extend_from_slice(&stage.schema_version.to_le_bytes());
    bytes.push(stage.network);
    bytes.extend_from_slice(stage.plan.as_ref());
    bytes.extend_from_slice(stage.market.as_ref());
    bytes.extend_from_slice(&stage.stage_index.to_le_bytes());
    bytes.extend_from_slice(&stage.raw_quantity.to_le_bytes());
    bytes.extend_from_slice(&stage.min_premium_bps.to_le_bytes());
    bytes.push(stage.allowed_session_mask);
    bytes.extend_from_slice(&stage.max_reference_age_seconds.to_le_bytes());
    bytes.extend_from_slice(&stage.next_commitment);
    bytes.extend_from_slice(&stage.salt);
    Ok(bytes)
}

pub fn hash_canonical_stage(stage: &CanonicalStageV1) -> Result<[u8; 32]> {
    Ok(hashv(&[&encode_canonical_stage(stage)?]).to_bytes())
}

pub struct CanonicalStageV1 {
    pub schema_version: u16,
    pub network: u8,
    pub plan: Pubkey,
    pub market: Pubkey,
    pub stage_index: u16,
    pub raw_quantity: u64,
    pub min_premium_bps: i32,
    pub allowed_session_mask: u8,
    pub max_reference_age_seconds: u32,
    pub next_commitment: [u8; 32],
    pub salt: [u8; 32],
}

pub struct CanonicalBuyRequestOpeningV1 {
    pub schema_version: u16,
    pub network: u8,
    pub request: Pubkey,
    pub buyer: Pubkey,
    pub recipient: Pubkey,
    pub market: Pubkey,
    pub target_raw_quantity: u64,
    pub max_premium_bps: i32,
    pub max_quote_amount: u64,
    pub expires_at: i64,
    pub allow_partial_fills: bool,
    pub request_nonce: u64,
    pub salt: [u8; 32],
}

pub fn encode_canonical_buy_request(opening: &CanonicalBuyRequestOpeningV1) -> Result<Vec<u8>> {
    require!(opening.schema_version == COMMITMENT_SCHEMA_VERSION, BazoError::UnsupportedCommitmentSchema);
    require!(opening.network == DEVNET_NETWORK_ID, BazoError::InvalidBuyRequestCommitment);
    require!(opening.target_raw_quantity > 0 && opening.max_quote_amount > 0, BazoError::InvalidQuoteAmount);
    require!(opening.max_premium_bps > -10_000, BazoError::InvalidBuyRequestCommitment);
    let mut bytes = Vec::with_capacity(219);
    bytes.extend_from_slice(BUY_REQUEST_DOMAIN);
    bytes.extend_from_slice(&opening.schema_version.to_le_bytes());
    bytes.push(opening.network);
    bytes.extend_from_slice(opening.request.as_ref());
    bytes.extend_from_slice(opening.buyer.as_ref());
    bytes.extend_from_slice(opening.recipient.as_ref());
    bytes.extend_from_slice(opening.market.as_ref());
    bytes.extend_from_slice(&opening.target_raw_quantity.to_le_bytes());
    bytes.extend_from_slice(&opening.max_premium_bps.to_le_bytes());
    bytes.extend_from_slice(&opening.max_quote_amount.to_le_bytes());
    bytes.extend_from_slice(&opening.expires_at.to_le_bytes());
    bytes.push(u8::from(opening.allow_partial_fills));
    bytes.extend_from_slice(&opening.request_nonce.to_le_bytes());
    bytes.extend_from_slice(&opening.salt);
    Ok(bytes)
}

pub fn hash_canonical_buy_request(opening: &CanonicalBuyRequestOpeningV1) -> Result<[u8; 32]> {
    Ok(hashv(&[&encode_canonical_buy_request(opening)?]).to_bytes())
}

fn is_zero_commitment(commitment: &[u8; 32]) -> bool {
    commitment.iter().all(|byte| *byte == 0)
}

#[derive(Clone)]
pub struct MatchBuyer {
    pub request: Pubkey,
    pub created_slot: u64,
    pub remaining_raw_quantity: u64,
    pub max_premium_bps: i32,
    pub allow_partial_fills: bool,
}

pub fn allocate_stage(raw_quantity: u64, min_premium_bps: i32, buyers: &[MatchBuyer]) -> Option<(Vec<(Pubkey, u64)>, i32)> {
    if raw_quantity == 0 || buyers.is_empty() || buyers.len() > MAX_BATCH_REQUESTS { return None; }
    let mut ordered = buyers.to_vec();
    ordered.sort_by(|a, b| b.max_premium_bps.cmp(&a.max_premium_bps)
        .then(a.created_slot.cmp(&b.created_slot))
        .then(a.request.to_bytes().cmp(&b.request.to_bytes())));
    if ordered.iter().enumerate().any(|(index, buyer)| ordered.iter().skip(index + 1).any(|other| buyer.request == other.request)) { return None; }
    let mut remainder = raw_quantity;
    let mut winners = Vec::new();
    for buyer in ordered {
        if buyer.max_premium_bps < min_premium_bps || buyer.remaining_raw_quantity == 0 { continue; }
        if !buyer.allow_partial_fills && buyer.remaining_raw_quantity > remainder { continue; }
        let amount = buyer.remaining_raw_quantity.min(remainder);
        winners.push((buyer.request, amount));
        remainder = remainder.checked_sub(amount)?;
        if remainder == 0 { return Some((winners, buyer.max_premium_bps)); }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::str::FromStr;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn canonical_stage_matches_the_golden_vector() {
        let plan = Pubkey::from_str("11111111111111111111111111111111").unwrap();
        let market = Pubkey::from_str("SysvarC1ock11111111111111111111111111111111").unwrap();
        let stage = CanonicalStageV1 {
            schema_version: COMMITMENT_SCHEMA_VERSION,
            network: DEVNET_NETWORK_ID,
            plan,
            market,
            stage_index: 0,
            raw_quantity: 2_500_001,
            min_premium_bps: 50,
            allowed_session_mask: 1,
            max_reference_age_seconds: 90,
            next_commitment: [3; 32],
            salt: [7; 32],
        };

        assert_eq!(
            hex(&encode_canonical_stage(&stage).unwrap()),
            "42415a4f5f53544147455f5631010001000000000000000000000000000000000000000000000000000000000000000006a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b21000000000000a12526000000000032000000015a00000003030303030303030303030303030303030303030303030303030303030303030707070707070707070707070707070707070707070707070707070707070707"
        );
        assert_eq!(
            hex(&terminal_commitment(plan, market)),
            "9b298f734062568ff3ada1ba001d6b6beb4b37be69548128adee191cdae665d1"
        );
    }

    #[test]
    fn accepts_only_the_scaled_ui_amount_stock_extension() {
        assert!(stock_extensions_are_supported(&[ExtensionType::ScaledUiAmount]));
        assert!(!stock_extensions_are_supported(&[]));
        assert!(!stock_extensions_are_supported(&[
            ExtensionType::ScaledUiAmount,
            ExtensionType::MintCloseAuthority,
        ]));
    }

    #[test]
    fn canonical_buy_request_matches_the_golden_vector() {
        let opening = CanonicalBuyRequestOpeningV1 {
            schema_version: 1, network: 1,
            request: Pubkey::from_str("11111111111111111111111111111111").unwrap(),
            buyer: Pubkey::from_str("SysvarC1ock11111111111111111111111111111111").unwrap(),
            recipient: Pubkey::from_str("SysvarRent111111111111111111111111111111111").unwrap(),
            market: Pubkey::from_str("Stake11111111111111111111111111111111111111").unwrap(),
            target_raw_quantity: 2_500_001, max_premium_bps: 100, max_quote_amount: 7_500_000,
            expires_at: 1_800_000_000, allow_partial_fills: true, request_nonce: 42, salt: [7; 32],
        };
        assert_eq!(encode_canonical_buy_request(&opening).unwrap().len(), 219);
        assert_eq!(hex(&hash_canonical_buy_request(&opening).unwrap()), "deb9b59583c806ea7c9674ba7dc02e9cbac549dbb92d3b238f2ce10e27c2c1c2");
    }

    #[test]
    fn matching_uses_the_shared_allocation_vector() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../packages/sdk/fixtures/batch-allocation.json")).unwrap();
        let seller = &fixture["seller"];
        let buyers: Vec<MatchBuyer> = fixture["buyers"].as_array().unwrap().iter().map(|buyer| MatchBuyer {
            request: Pubkey::from_str(buyer["request"].as_str().unwrap()).unwrap(),
            created_slot: buyer["createdSlot"].as_str().unwrap().parse().unwrap(),
            remaining_raw_quantity: buyer["remainingRawQuantity"].as_str().unwrap().parse().unwrap(),
            max_premium_bps: buyer["maxPremiumBps"].as_i64().unwrap() as i32,
            allow_partial_fills: buyer["allowPartialFills"].as_bool().unwrap(),
        }).collect();
        let quantity = seller["rawQuantity"].as_str().unwrap().parse().unwrap();
        let premium = seller["minPremiumBps"].as_i64().unwrap() as i32;
        let (winners, marginal) = allocate_stage(quantity, premium, &buyers).unwrap();
        let amounts: Vec<String> = winners.iter().map(|(_, amount)| amount.to_string()).collect();
        let expected: Vec<String> = fixture["expectedAllocations"].as_array().unwrap().iter().map(|value| value.as_str().unwrap().to_string()).collect();
        assert_eq!(amounts, expected);
        assert_eq!(marginal, fixture["expectedMarginalPremiumBps"].as_i64().unwrap() as i32);
        let mut short = buyers.clone();
        short[2].remaining_raw_quantity = 2;
        assert!(allocate_stage(quantity, premium, &short).is_none());
        let mut non_partial = buyers.clone();
        non_partial[2].allow_partial_fills = false;
        assert!(allocate_stage(quantity, premium, &non_partial).is_none());
    }
}
