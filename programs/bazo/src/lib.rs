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
pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";
pub const MARKET_SEED: &[u8] = b"market";
pub const PLAN_SEED: &[u8] = b"plan";
pub const STOCK_VAULT_SEED: &[u8] = b"plan-stock-vault";
pub const PROCEEDS_VAULT_SEED: &[u8] = b"plan-proceeds-vault";
pub const DEVNET_STOCK_FAUCET_SEED: &[u8] = b"devnet-stock-faucet";
pub const DEVNET_STOCK_CLAIM_SEED: &[u8] = b"devnet-stock-claim";
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
    #[account(owner = anchor_spl::token_2022::ID @ BazoError::UnsupportedTokenProgram)]
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

fn is_zero_commitment(commitment: &[u8; 32]) -> bool {
    commitment.iter().all(|byte| *byte == 0)
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
}
