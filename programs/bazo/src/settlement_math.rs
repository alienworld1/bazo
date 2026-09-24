use ethnum::U256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteMathError {
    InvalidInput,
    Overflow,
}

pub fn quote_charge(
    raw_stock: u64,
    stock_decimals: u8,
    multiplier_bits: u64,
    raw_price: i64,
    price_exponent: i16,
    premium_bps: i32,
    quote_decimals: u8,
) -> Result<u64, QuoteMathError> {
    if raw_stock == 0
        || raw_price <= 0
        || !(-18..=18).contains(&price_exponent)
        || stock_decimals > 18
        || quote_decimals > 18
        || !(-9_999..=1_000_000).contains(&premium_bps)
    {
        return Err(QuoteMathError::InvalidInput);
    }

    let (multiplier_numerator, multiplier_denominator) = multiplier_ratio(multiplier_bits)?;
    let mut numerator = U256::from(raw_stock);
    for factor in [
        multiplier_numerator,
        U256::from(raw_price as u64),
        U256::from((10_000 + premium_bps) as u64),
        power_of_ten(quote_decimals)?,
    ] {
        numerator = numerator
            .checked_mul(factor)
            .ok_or(QuoteMathError::Overflow)?;
    }
    let mut denominator = multiplier_denominator;
    for factor in [power_of_ten(stock_decimals)?, U256::from(10_000u64)] {
        denominator = denominator
            .checked_mul(factor)
            .ok_or(QuoteMathError::Overflow)?;
    }
    if price_exponent >= 0 {
        numerator = numerator
            .checked_mul(power_of_ten(price_exponent as u8)?)
            .ok_or(QuoteMathError::Overflow)?;
    } else {
        denominator = denominator
            .checked_mul(power_of_ten((-price_exponent) as u8)?)
            .ok_or(QuoteMathError::Overflow)?;
    }
    let charge = numerator
        .checked_add(denominator - U256::ONE)
        .ok_or(QuoteMathError::Overflow)?
        / denominator;
    if charge == U256::ZERO || charge > U256::from(u64::MAX) {
        return Err(QuoteMathError::Overflow);
    }
    Ok(charge.as_u64())
}

fn multiplier_ratio(bits: u64) -> Result<(U256, U256), QuoteMathError> {
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1u64 << 52) - 1);
    if bits >> 63 != 0 || exponent == 0 || exponent == 0x7ff {
        return Err(QuoteMathError::InvalidInput);
    }
    let mantissa = (1u64 << 52) | fraction;
    let shift = exponent - 1023 - 52;
    if !(-64..=64).contains(&shift) {
        return Err(QuoteMathError::InvalidInput);
    }
    let (numerator, denominator) = if shift >= 0 {
        (U256::from(mantissa) << shift as u32, U256::ONE)
    } else {
        (U256::from(mantissa), U256::ONE << (-shift) as u32)
    };
    if numerator > denominator * U256::from(1_000_000u64)
        || numerator * U256::from(1_000_000u64) < denominator
    {
        return Err(QuoteMathError::InvalidInput);
    }
    Ok((numerator, denominator))
}

fn power_of_ten(exponent: u8) -> Result<U256, QuoteMathError> {
    U256::from(10u8)
        .checked_pow(exponent as u32)
        .ok_or(QuoteMathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn shared_quote_vectors() {
        let vectors: Vec<Value> = serde_json::from_str(include_str!(
            "../../../packages/sdk/fixtures/settlement-quote.json"
        ))
        .unwrap();
        assert!(vectors.len() >= 20);
        for vector in vectors {
            let read = |name: &str| vector[name].as_str().unwrap().parse::<u64>().unwrap();
            let multiplier = u64::from_str_radix(
                vector["multiplierBits"]
                    .as_str()
                    .unwrap()
                    .trim_start_matches("0x"),
                16,
            )
            .unwrap();
            let charge = quote_charge(
                read("rawStock"),
                vector["stockDecimals"].as_u64().unwrap() as u8,
                multiplier,
                read("rawPrice") as i64,
                vector["priceExponent"].as_i64().unwrap() as i16,
                vector["premiumBps"].as_i64().unwrap() as i32,
                vector["quoteDecimals"].as_u64().unwrap() as u8,
            )
            .unwrap();
            assert_eq!(charge, read("expectedCharge"));
        }
    }

    #[test]
    fn invalid_multiplier_and_overflow_are_rejected() {
        assert_eq!(
            quote_charge(1, 0, f64::INFINITY.to_bits(), 1, 0, 0, 0),
            Err(QuoteMathError::InvalidInput)
        );
        assert_eq!(
            quote_charge(u64::MAX, 0, 1f64.to_bits(), i64::MAX, 0, 0, 0),
            Err(QuoteMathError::Overflow)
        );
    }
}
