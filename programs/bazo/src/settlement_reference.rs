use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use pyth_lazer_solana_contract::protocol::{
    api::MarketSession,
    message::SolanaMessage,
    payload::{PayloadData, PayloadPropertyValue},
};
use solana_sha256_hasher::hashv;

use crate::{BazoError, Market, SettlementPolicy};

pub struct VerifiedReference {
    pub price: i64,
    pub exponent: i16,
    pub confidence: i64,
    pub publisher_count: u16,
    pub session_mask: u8,
    pub feed_update_timestamp_us: u64,
}

pub struct VerifierAccounts<'a, 'info> {
    pub payer: &'a AccountInfo<'info>,
    pub program: &'a AccountInfo<'info>,
    pub storage: &'a AccountInfo<'info>,
    pub treasury: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub instructions_sysvar: &'a AccountInfo<'info>,
}

pub fn verify_reference(
    signed_bytes: &[u8],
    accounts: &VerifierAccounts<'_, '_>,
    market: &Market,
    policy: &SettlementPolicy,
    stage_session_mask: u8,
    stage_max_age_seconds: u32,
    chain_time: i64,
) -> Result<VerifiedReference> {
    require!(signed_bytes.len() >= 102, BazoError::InvalidReference);
    let signed = SolanaMessage::deserialize_slice(signed_bytes)
        .map_err(|_| error!(BazoError::InvalidReference))?;
    require!(
        signed_bytes.len() == 102 + signed.payload.len(),
        BazoError::InvalidReference
    );

    let program_id = Pubkey::new_from_array(pyth_lazer_solana_contract::ID.to_bytes());
    let storage_id = Pubkey::new_from_array(pyth_lazer_solana_contract::STORAGE_ID.to_bytes());
    require!(
        accounts.program.key() == program_id && accounts.program.executable,
        BazoError::InvalidVerifier
    );
    require!(
        accounts.storage.key() == storage_id && accounts.storage.owner == &program_id,
        BazoError::InvalidVerifier
    );
    let mut data = Vec::with_capacity(8 + 4 + signed_bytes.len() + 3);
    data.extend_from_slice(&hashv(&[b"global:verify_message"]).to_bytes()[..8]);
    data.extend_from_slice(&(signed_bytes.len() as u32).to_le_bytes());
    data.extend_from_slice(signed_bytes);
    data.extend_from_slice(&0u16.to_le_bytes());
    data.push(0);
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(accounts.payer.key(), true),
            AccountMeta::new_readonly(accounts.storage.key(), false),
            AccountMeta::new(accounts.treasury.key(), false),
            AccountMeta::new_readonly(accounts.system_program.key(), false),
            AccountMeta::new_readonly(accounts.instructions_sysvar.key(), false),
        ],
        data,
    };
    invoke(
        &instruction,
        &[
            accounts.payer.clone(),
            accounts.storage.clone(),
            accounts.treasury.clone(),
            accounts.system_program.clone(),
            accounts.instructions_sysvar.clone(),
            accounts.program.clone(),
        ],
    )?;

    parse_reference(
        &signed.payload,
        market,
        policy,
        stage_session_mask,
        stage_max_age_seconds,
        chain_time,
    )
}

fn parse_reference(
    payload_bytes: &[u8],
    market: &Market,
    policy: &SettlementPolicy,
    stage_session_mask: u8,
    stage_max_age_seconds: u32,
    chain_time: i64,
) -> Result<VerifiedReference> {
    let payload = PayloadData::deserialize_slice_le(payload_bytes)
        .map_err(|_| error!(BazoError::InvalidReference))?;
    require!(payload.feeds.len() == 1, BazoError::InvalidReference);
    let feed = &payload.feeds[0];
    require!(
        u64::from(feed.feed_id.0) == market.pyth_feed_id,
        BazoError::WrongReferenceFeed
    );
    let mut price = None;
    let mut exponent = None;
    let mut confidence = None;
    let mut publisher_count = None;
    let mut session = None;
    let mut update_timestamp = None;
    for property in &feed.properties {
        match property {
            PayloadPropertyValue::Price(Some(value)) if price.is_none() => {
                price = Some(value.mantissa_i64())
            }
            PayloadPropertyValue::Exponent(value) if exponent.is_none() => exponent = Some(*value),
            PayloadPropertyValue::Confidence(Some(value)) if confidence.is_none() => {
                confidence = Some(value.mantissa_i64())
            }
            PayloadPropertyValue::PublisherCount(value) if publisher_count.is_none() => {
                publisher_count = Some(*value)
            }
            PayloadPropertyValue::MarketSession(value) if session.is_none() => {
                session = Some(*value)
            }
            PayloadPropertyValue::FeedUpdateTimestamp(Some(value))
                if update_timestamp.is_none() =>
            {
                update_timestamp = Some(value.as_micros())
            }
            _ => return err!(BazoError::InvalidReference),
        }
    }
    require!(feed.properties.len() == 6, BazoError::InvalidReference);
    let price = price.ok_or(BazoError::InvalidReference)?;
    let exponent = exponent.ok_or(BazoError::InvalidReference)?;
    let confidence = confidence.ok_or(BazoError::InvalidReference)?;
    let publisher_count = publisher_count.ok_or(BazoError::InvalidReference)?;
    let update_timestamp = update_timestamp.ok_or(BazoError::InvalidReference)?;
    let session_mask = match session.ok_or(BazoError::InvalidReference)? {
        MarketSession::Regular => 1,
        MarketSession::PreMarket => 2,
        MarketSession::PostMarket => 4,
        MarketSession::OverNight => 8,
        MarketSession::Closed => return err!(BazoError::ClosedReferenceSession),
    };
    require!(
        price > 0 && confidence >= 0 && (-18..=18).contains(&exponent),
        BazoError::InvalidReference
    );
    require!(
        market.allowed_session_mask & stage_session_mask & session_mask != 0,
        BazoError::ClosedReferenceSession
    );
    require!(
        publisher_count >= policy.minimum_publisher_count,
        BazoError::WeakReference
    );
    require!(
        (confidence as u128) * 10_000
            <= (price as u128) * u128::from(policy.maximum_confidence_ratio_bps),
        BazoError::WeakReference,
    );
    let now_us = u64::try_from(chain_time)
        .map_err(|_| error!(BazoError::InvalidReference))?
        .checked_mul(1_000_000)
        .ok_or(BazoError::InvalidReference)?;
    require!(
        update_timestamp <= now_us.saturating_add(30_000_000),
        BazoError::InvalidReference
    );
    let max_age_us =
        u64::from(market.max_reference_age_seconds.min(stage_max_age_seconds)) * 1_000_000;
    require!(
        now_us.saturating_sub(update_timestamp) <= max_age_us,
        BazoError::StaleReference
    );
    Ok(VerifiedReference {
        price,
        exponent,
        confidence,
        publisher_count,
        session_mask,
        feed_update_timestamp_us: update_timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use byteorder::LE;
    use pyth_lazer_solana_contract::protocol::{
        payload::PayloadFeedData, time::TimestampUs, ChannelId, Price, PriceFeedId,
    };

    fn market() -> Market {
        Market {
            version: 1,
            authority: Pubkey::default(),
            stock_mint: Pubkey::default(),
            stock_token_program: Pubkey::default(),
            quote_mint: Pubkey::default(),
            quote_token_program: Pubkey::default(),
            pyth_feed_id: 1435,
            allowed_session_mask: 1,
            max_reference_age_seconds: 90,
            minimum_stage_raw_amount: 1,
            supported_stock_extensions: 1,
            enabled: true,
            bump: 0,
        }
    }

    fn policy() -> SettlementPolicy {
        SettlementPolicy {
            version: 1,
            market: Pubkey::default(),
            minimum_publisher_count: 2,
            maximum_confidence_ratio_bps: 100,
            reservation_authority: Pubkey::default(),
            bump: 0,
        }
    }

    fn payload(
        feed_id: u32,
        update_us: u64,
        session: MarketSession,
        publishers: u16,
        confidence: i64,
    ) -> Vec<u8> {
        let data = PayloadData {
            timestamp_us: TimestampUs::from_micros(100_000_000),
            channel_id: ChannelId(1),
            feeds: vec![PayloadFeedData {
                feed_id: PriceFeedId(feed_id),
                properties: vec![
                    PayloadPropertyValue::Price(Some(Price::from_integer(100_000, 0).unwrap())),
                    PayloadPropertyValue::Exponent(-3),
                    PayloadPropertyValue::Confidence(Some(
                        Price::from_integer(confidence, 0).unwrap(),
                    )),
                    PayloadPropertyValue::PublisherCount(publishers),
                    PayloadPropertyValue::MarketSession(session),
                    PayloadPropertyValue::FeedUpdateTimestamp(Some(TimestampUs::from_micros(
                        update_us,
                    ))),
                ],
            }],
        };
        let mut bytes = Vec::new();
        data.serialize::<LE>(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn accepts_exact_feed_and_fresh_open_reference() {
        let result = parse_reference(
            &payload(1435, 99_000_000, MarketSession::Regular, 2, 100),
            &market(),
            &policy(),
            1,
            90,
            100,
        )
        .unwrap();
        assert_eq!(result.price, 100_000);
        assert_eq!(result.exponent, -3);
        assert_eq!(result.feed_update_timestamp_us, 99_000_000);
    }

    #[test]
    fn rejects_wrong_feed_and_carried_forward_update() {
        assert!(parse_reference(
            &payload(1436, 99_000_000, MarketSession::Regular, 2, 100),
            &market(),
            &policy(),
            1,
            90,
            100
        )
        .is_err());
        assert!(parse_reference(
            &payload(1435, 1_000_000, MarketSession::Regular, 2, 100),
            &market(),
            &policy(),
            1,
            90,
            100
        )
        .is_err());
    }

    #[test]
    fn rejects_closed_weak_and_wide_reference() {
        assert!(parse_reference(
            &payload(1435, 99_000_000, MarketSession::Closed, 2, 100),
            &market(),
            &policy(),
            1,
            90,
            100
        )
        .is_err());
        assert!(parse_reference(
            &payload(1435, 99_000_000, MarketSession::Regular, 1, 100),
            &market(),
            &policy(),
            1,
            90,
            100
        )
        .is_err());
        assert!(parse_reference(
            &payload(1435, 99_000_000, MarketSession::Regular, 2, 2_000),
            &market(),
            &policy(),
            1,
            90,
            100
        )
        .is_err());
    }
}
