use anchor_lang::prelude::*;

declare_id!("6e35GBMnuKLhWCJe3qmzWuJbN9L6XCTMPvAx5hgXLagb");

pub const PROTOCOL_VERSION: u16 = 1;
pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";

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

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub version: u16,
    pub authority: Pubkey,
    pub bump: u8,
}

#[event]
pub struct ProtocolInitialized {
    pub protocol_config: Pubkey,
    pub authority: Pubkey,
    pub version: u16,
}
