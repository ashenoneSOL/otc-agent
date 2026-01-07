#![allow(deprecated)]
#![allow(clippy::unnecessary_cast)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked,
};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");

#[event]
pub struct OfferCreated {
    pub desk: Pubkey,
    pub offer: Pubkey,
    pub beneficiary: Pubkey,
    pub token_amount: u64,
    pub discount_bps: u16,
    pub currency: u8,
}

#[event]
pub struct OfferApproved { pub offer: Pubkey, pub approver: Pubkey }

#[event]
pub struct OfferCancelled { pub offer: Pubkey, pub by: Pubkey }

#[event]
pub struct OfferPaid { pub offer: Pubkey, pub payer: Pubkey, pub amount: u64, pub currency: u8 }

#[event]
pub struct AgentCommissionPaid { pub offer: Pubkey, pub agent: Pubkey, pub amount: u64, pub currency: u8 }

#[event]
pub struct TokensClaimed { pub offer: Pubkey, pub beneficiary: Pubkey, pub amount: u64 }

#[event]
pub struct LimitsUpdated { pub min_usd_amount_8d: u64, pub max_token_per_order: u64, pub quote_expiry_secs: i64, pub default_unlock_delay_secs: i64, pub max_lockup_secs: i64 }

#[event]
pub struct PricesUpdated { pub token_usd_8d: u64, pub sol_usd_8d: u64, pub updated_at: i64, pub max_age: i64 }

#[event]
pub struct RestrictFulfillUpdated { pub enabled: bool }

#[event]
pub struct Paused { pub paused: bool }

#[allow(deprecated)]
#[program]
pub mod otc {
    use super::*;

    pub fn init_desk(
        ctx: Context<InitDesk>,
        min_usd_amount_8d: u64,
        quote_expiry_secs: i64,
    ) -> Result<()> {
        // Validate inputs
        require!(ctx.accounts.agent.key() != Pubkey::default(), OtcError::BadState);
        require!(min_usd_amount_8d > 0, OtcError::AmountRange);
        require!(quote_expiry_secs >= 60, OtcError::AmountRange); // Minimum 60 seconds to prevent race conditions
        
        let desk = &mut ctx.accounts.desk;
        desk.owner = ctx.accounts.owner.key();
        desk.agent = ctx.accounts.agent.key();
        desk.usdc_mint = ctx.accounts.usdc_mint.key();
        desk.usdc_decimals = ctx.accounts.usdc_mint.decimals;
        require!(desk.usdc_decimals == 6, OtcError::UsdcDecimals);
        desk.min_usd_amount_8d = min_usd_amount_8d;
        desk.quote_expiry_secs = quote_expiry_secs;
        desk.max_price_age_secs = 3600;
        desk.restrict_fulfill = false;
        desk.next_consignment_id = 1;
        desk.next_offer_id = 1;
        desk.paused = false;
        desk.sol_price_feed_id = [0u8; 32];
        desk.sol_usd_price_8d = 0;
        desk.prices_updated_at = 0;
        // All tokens are equal - use TokenRegistry for each token
        // No primary token - these fields are deprecated but kept for account size compatibility
        desk.token_mint = Pubkey::default();
        desk.token_decimals = 0;
        desk.token_deposited = 0;
        desk.token_reserved = 0;
        desk.token_price_feed_id = [0u8; 32];
        desk.token_usd_price_8d = 0;
        desk.default_unlock_delay_secs = 0;
        desk.max_lockup_secs = 365 * 86400; // 1 year default
        desk.max_token_per_order = u64::MAX; // No limit - each TokenRegistry has its own limits
        desk.emergency_refund_enabled = false;
        desk.emergency_refund_deadline_secs = 30 * 86400; // 30 days default
        desk.approvers = Vec::new();
        desk.p2p_commission_bps = 25; // Default: 0.25% commission for P2P deals
        Ok(())
    }

    /// Transfer desk ownership to a new owner
    /// Only the current owner can call this
    pub fn transfer_owner(ctx: Context<TransferOwnership>, new_owner: Pubkey) -> Result<()> {
        require!(new_owner != Pubkey::default(), OtcError::BadState);
        let desk = &mut ctx.accounts.desk;
        let old_owner = desk.owner;
        desk.owner = new_owner;
        msg!("Desk ownership transferred from {} to {}", old_owner, new_owner);
        Ok(())
    }

    pub fn register_token(
        ctx: Context<RegisterToken>,
        price_feed_id: [u8; 32],
        pool_address: Pubkey,
        pool_type: u8, // 0=None, 1=Raydium, 2=Orca, 3=PumpSwap
    ) -> Result<()> {
        // Permissionless registration
        // Optional: Charge a fee? 
        // For now, we just check that the desk is valid and token isn't already registered (handled by init constraints)
        
        let registry = &mut ctx.accounts.token_registry;
        registry.desk = ctx.accounts.desk.key();
        registry.token_mint = ctx.accounts.token_mint.key();
        registry.decimals = ctx.accounts.token_mint.decimals;
        registry.price_feed_id = price_feed_id;
        registry.pool_address = pool_address;
        registry.pool_type = match pool_type {
            1 => PoolType::Raydium,
            2 => PoolType::Orca,
            3 => PoolType::PumpSwap,
            _ => PoolType::None,
        };
        registry.is_active = true;
        registry.token_usd_price_8d = 0;
        registry.prices_updated_at = 0;
        registry.registered_by = ctx.accounts.payer.key();
        // Initialize TWAP fields
        registry.min_liquidity = 0; // No minimum by default
        registry.twap_cumulative_price = 0;
        registry.twap_last_timestamp = 0;
        registry.twap_last_price = 0;
        registry.max_twap_deviation_bps = 0; // Disabled by default
        registry.min_update_interval_secs = 60; // Minimum 1 minute between updates
        
        Ok(())
    }

    pub fn create_consignment(
        ctx: Context<CreateConsignment>,
        amount: u64,
        is_negotiable: bool,
        fixed_discount_bps: u16,
        fixed_lockup_days: u32,
        min_discount_bps: u16,
        max_discount_bps: u16,
        min_lockup_days: u32,
        max_lockup_days: u32,
        min_deal_amount: u64,
        max_deal_amount: u64,
        is_fractionalized: bool,
        is_private: bool,
        max_price_volatility_bps: u16,
        max_time_to_execute_secs: i64,
    ) -> Result<()> {
        let desk = &mut ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        require!(amount > 0, OtcError::AmountRange);
        require!(min_deal_amount <= max_deal_amount, OtcError::AmountRange);
        require!(min_discount_bps <= max_discount_bps, OtcError::Discount);
        require!(max_discount_bps <= 10000, OtcError::Discount); // Max 100% discount
        require!(fixed_discount_bps <= 10000, OtcError::Discount); // Max 100% discount
        require!(min_lockup_days <= max_lockup_days, OtcError::LockupTooLong);

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.consigner_token_ata.to_account_info(),
            to: ctx.accounts.desk_token_treasury.to_account_info(),
            authority: ctx.accounts.consigner.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, amount, ctx.accounts.token_mint.decimals)?;

        let consignment_id = desk.next_consignment_id;
        desk.next_consignment_id = consignment_id.checked_add(1).ok_or(OtcError::Overflow)?;

        let consignment = &mut ctx.accounts.consignment;
        consignment.desk = desk.key();
        consignment.id = consignment_id;
        consignment.token_mint = ctx.accounts.token_mint.key();
        consignment.consigner = ctx.accounts.consigner.key();
        consignment.total_amount = amount;
        consignment.remaining_amount = amount;
        consignment.is_negotiable = is_negotiable;
        consignment.fixed_discount_bps = fixed_discount_bps;
        consignment.fixed_lockup_days = fixed_lockup_days;
        consignment.min_discount_bps = min_discount_bps;
        consignment.max_discount_bps = max_discount_bps;
        consignment.min_lockup_days = min_lockup_days;
        consignment.max_lockup_days = max_lockup_days;
        consignment.min_deal_amount = min_deal_amount;
        consignment.max_deal_amount = max_deal_amount;
        consignment.is_fractionalized = is_fractionalized;
        consignment.is_private = is_private;
        consignment.max_price_volatility_bps = max_price_volatility_bps;
        consignment.max_time_to_execute_secs = max_time_to_execute_secs;
        consignment.is_active = true;
        consignment.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn set_prices(ctx: Context<OnlyOwnerDesk>, token_usd_8d: u64, sol_usd_8d: u64, _updated_at: i64, max_age: i64) -> Result<()> {
        require!(max_age >= 0, OtcError::AmountRange);
        // Add price bounds checking like EVM version
        require!(token_usd_8d > 0 && token_usd_8d <= 1_000_000_000_000, OtcError::BadPrice); // Max $10,000 per token (8 decimals)
        require!(sol_usd_8d >= 1_000_000 && sol_usd_8d <= 10_000_000_000_000, OtcError::BadPrice); // $0.01 - $100,000
        
        let now = Clock::get()?.unix_timestamp;
        let desk = &mut ctx.accounts.desk;
        desk.token_usd_price_8d = token_usd_8d;
        desk.sol_usd_price_8d = sol_usd_8d;
        desk.prices_updated_at = now;
        desk.max_price_age_secs = max_age;
        emit!(PricesUpdated { token_usd_8d, sol_usd_8d, updated_at: now, max_age });
        Ok(())
    }

    pub fn set_pyth_feeds(ctx: Context<OnlyOwnerDesk>, token_feed_id: [u8; 32], sol_feed_id: [u8; 32]) -> Result<()> {
        let desk = &mut ctx.accounts.desk;
        desk.token_price_feed_id = token_feed_id;
        desk.sol_price_feed_id = sol_feed_id;
        Ok(())
    }

    pub fn set_token_oracle_feed(ctx: Context<SetTokenOracleFeed>, feed_id: [u8; 32]) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        registry.price_feed_id = feed_id;
        Ok(())
    }

    /// Set/update the pool address and type for automatic price updates
    /// Can be called by owner OR the original registrant (permissionless for the registrant)
    pub fn set_token_pool_config(
        ctx: Context<SetTokenPoolConfig>,
        pool_address: Pubkey,
        pool_type: u8, // 0=None, 1=Raydium, 2=Orca, 3=PumpSwap
    ) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        let desk = &ctx.accounts.desk;
        let signer = &ctx.accounts.signer;
        
        // Allow owner OR the original registrant to update
        require!(
            signer.key() == desk.owner || signer.key() == registry.registered_by,
            OtcError::NotOwner
        );
        
        registry.pool_address = pool_address;
        registry.pool_type = match pool_type {
            1 => PoolType::Raydium,
            2 => PoolType::Orca,
            3 => PoolType::PumpSwap,
            _ => PoolType::None,
        };
        Ok(())
    }

    /// Manual price setting for testing/emergency use
    /// Production should primarily use Pyth oracle or on-chain pool pricing
    /// NOTE: This function should be restricted via access control in production
    pub fn set_manual_token_price(ctx: Context<SetManualTokenPrice>, price_8d: u64) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        // Price bounds: $0.00000001 to $10,000 (8 decimals)
        require!(price_8d > 0 && price_8d <= 1_000_000_000_000, OtcError::BadPrice);
        require!(registry.is_active, OtcError::BadState);
        registry.token_usd_price_8d = price_8d;
        registry.prices_updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn update_token_price_from_pyth(
        ctx: Context<UpdateTokenPriceFromPyth>,
        max_price_deviation_bps: u16,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        let desk = &ctx.accounts.desk;
        
        // Verify feed ID matches registry
        // In this instruction, the caller provides the account for the feed. 
        // We don't check feed_id bytes against argument, we check the account's key?
        // Pyth SDK uses `price_update` account which contains the price message.
        // The feed ID is inside the message.
        
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        require!(desk.max_price_age_secs >= 0, OtcError::AmountRange);
        // SAFETY: require! above ensures max_price_age_secs >= 0
        #[allow(clippy::cast_sign_loss)]
        let max_age = desk.max_price_age_secs as u64;

        let token_price = ctx.accounts.price_feed
            .get_price_no_older_than(&clock, max_age, &registry.price_feed_id)
            .map_err(|_| OtcError::StalePrice)?;

        let token_usd_8d = convert_pyth_price(token_price.price, token_price.exponent)?;
        check_price_deviation(registry.token_usd_price_8d, token_usd_8d, max_price_deviation_bps)?;
        registry.token_usd_price_8d = token_usd_8d;
        registry.prices_updated_at = current_time;
        Ok(())
    }

    /// Configure pool oracle security settings (owner only)
    pub fn configure_pool_oracle(
        ctx: Context<ConfigurePoolOracle>,
        min_liquidity: u64,
        max_twap_deviation_bps: u16,
        min_update_interval_secs: i64,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        require!(min_update_interval_secs >= 30, OtcError::AmountRange); // Minimum 30 seconds
        require!(max_twap_deviation_bps <= 5000, OtcError::AmountRange); // Max 50% deviation
        
        registry.min_liquidity = min_liquidity;
        registry.max_twap_deviation_bps = max_twap_deviation_bps;
        registry.min_update_interval_secs = min_update_interval_secs;
        Ok(())
    }

    /// Update token price from AMM pool with EMA smoothing and manipulation resistance
    pub fn update_token_price_from_pool(
        ctx: Context<UpdateTokenPriceFromPool>,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        require!(registry.pool_address != Pubkey::default(), OtcError::FeedNotConfigured);
        require!(registry.is_active, OtcError::BadState);
        
        let now = Clock::get()?.unix_timestamp;
        
        // Rate limiting
        if registry.prices_updated_at > 0 {
            let time_since_update = now.checked_sub(registry.prices_updated_at).ok_or(OtcError::Overflow)?;
            require!(time_since_update >= registry.min_update_interval_secs, OtcError::UpdateTooFrequent);
        }
        
        // Verify AMM program ID
        let pool_owner = ctx.accounts.pool.owner;
        let valid_program = match registry.pool_type {
            PoolType::Raydium => is_raydium_program(pool_owner),
            PoolType::Orca => is_orca_program(pool_owner),
            PoolType::PumpSwap => is_pumpswap_program(pool_owner),
            PoolType::None => return err!(OtcError::InvalidPoolProgram),
        };
        require!(valid_program, OtcError::InvalidPoolProgram);
        
        let vault_a = &ctx.accounts.vault_a;
        let vault_b = &ctx.accounts.vault_b;
        
        let amount_a = vault_a.amount;
        let amount_b = vault_b.amount;
        
        require!(amount_a > 0 && amount_b > 0, OtcError::StalePrice);
        
        // Min liquidity check
        if registry.min_liquidity > 0 {
            require!(amount_b >= registry.min_liquidity, OtcError::InsufficientLiquidity);
        }
        
        // Calculate spot price: vault_a = Token, vault_b = Quote (USDC, 6 decimals)
        let quote_decimals = 6u32;
        let token_decimals = registry.decimals as u32;
        
        // price = amount_b * 10^8 * 10^token_dec / (amount_a * 10^quote_dec)
        let num = (amount_b as u128)
            .checked_mul(100_000_000)
            .ok_or(OtcError::Overflow)?
            .checked_mul(pow10(token_decimals))
            .ok_or(OtcError::Overflow)?;
            
        let den = (amount_a as u128)
            .checked_mul(pow10(quote_decimals))
            .ok_or(OtcError::Overflow)?;
            
        let spot_price_8d = u64::try_from(num.checked_div(den).ok_or(OtcError::Overflow)?).map_err(|_| OtcError::Overflow)?;
        require!(spot_price_8d > 0, OtcError::BadPrice);
        
        // EMA smoothing: new_ema = (old_ema * weight + spot) / (weight + 1), weight capped at 3600s
        let final_price = if registry.twap_last_timestamp > 0 && registry.max_twap_deviation_bps > 0 {
            let time_elapsed = now.checked_sub(registry.twap_last_timestamp).ok_or(OtcError::Overflow)?;
            if time_elapsed > 0 {
                #[allow(clippy::cast_sign_loss)]
                let weight = time_elapsed.min(3600) as u128;
                let old_ema = registry.token_usd_price_8d as u128;
                let numerator = old_ema
                    .checked_mul(weight)
                    .ok_or(OtcError::Overflow)?
                    .checked_add(spot_price_8d as u128)
                    .ok_or(OtcError::Overflow)?;
                let denominator = weight.checked_add(1).ok_or(OtcError::Overflow)?;
                let new_ema = numerator.checked_div(denominator).ok_or(OtcError::Overflow)?;
                
                let ema_price = u64::try_from(new_ema).map_err(|_| OtcError::Overflow)?;
                
                // Check deviation from EMA
                let deviation = if spot_price_8d > ema_price {
                    spot_price_8d - ema_price
                } else {
                    ema_price - spot_price_8d
                };
                
                let max_deviation = (ema_price as u128)
                    .checked_mul(registry.max_twap_deviation_bps as u128)
                    .ok_or(OtcError::Overflow)?
                    .checked_div(10000)
                    .ok_or(OtcError::Overflow)?;
                    
                require!(deviation as u128 <= max_deviation, OtcError::TwapDeviationTooLarge);
                ema_price
            } else {
                spot_price_8d
            }
        } else {
            spot_price_8d
        };
        
        registry.twap_last_price = spot_price_8d;
        registry.twap_last_timestamp = now;
        registry.token_usd_price_8d = final_price;
        registry.prices_updated_at = now;
        
        Ok(())
    }

    /// Update token price from PumpSwap bonding curve
    pub fn update_token_price_from_pumpswap(
        ctx: Context<UpdateTokenPriceFromPumpswap>,
        sol_usd_price_8d: u64, // SOL/USD price with 8 decimals (from Pyth or other source)
    ) -> Result<()> {
        let registry = &mut ctx.accounts.token_registry;
        require!(registry.pool_address != Pubkey::default(), OtcError::FeedNotConfigured);
        require!(registry.pool_type == PoolType::PumpSwap, OtcError::BadState);
        require!(sol_usd_price_8d > 0, OtcError::BadPrice);
        
        let sol_amount = ctx.accounts.sol_vault.lamports();
        let token_amount = ctx.accounts.token_vault.amount;
        require!(sol_amount > 0 && token_amount > 0, OtcError::StalePrice);
        
        let token_decimals = registry.decimals as u32;
        // price_usd = sol_amount * sol_usd * 10^token_dec / (token_amount * 10^17)
        let numerator = (sol_amount as u128)
            .checked_mul(sol_usd_price_8d as u128)
            .ok_or(OtcError::Overflow)?
            .checked_mul(pow10(token_decimals))
            .ok_or(OtcError::Overflow)?;
            
        let denominator = (token_amount as u128)
            .checked_mul(pow10(17)) // 10^9 (SOL decimals) * 10^8 (price decimals)
            .ok_or(OtcError::Overflow)?;
            
        let price_8d = u64::try_from(numerator.checked_div(denominator).ok_or(OtcError::Overflow)?).map_err(|_| OtcError::Overflow)?;
        
        require!(price_8d > 0, OtcError::BadPrice);
        
        registry.token_usd_price_8d = price_8d;
        registry.prices_updated_at = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    pub fn update_prices_from_pyth(
        ctx: Context<UpdatePricesFromPyth>,
        token_feed_id: [u8; 32],
        sol_feed_id: [u8; 32],
        max_price_deviation_bps: u16,
    ) -> Result<()> {
        let desk = &mut ctx.accounts.desk;
        // Enforce configured feed IDs and ignore arbitrary input
        require!(desk.token_price_feed_id != [0u8; 32] && desk.sol_price_feed_id != [0u8; 32], OtcError::FeedNotConfigured);
        require!(desk.token_price_feed_id == token_feed_id && desk.sol_price_feed_id == sol_feed_id, OtcError::BadState);
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        require!(desk.max_price_age_secs >= 0, OtcError::AmountRange);
        // SAFETY: require! above ensures max_price_age_secs >= 0
        #[allow(clippy::cast_sign_loss)]
        let max_age = desk.max_price_age_secs as u64;

        // Get prices from Pyth with feed ID validation
        let token_price = ctx.accounts.token_price_feed
            .get_price_no_older_than(&clock, max_age, &desk.token_price_feed_id)
            .map_err(|_| OtcError::StalePrice)?;
        
        let sol_price = ctx.accounts.sol_price_feed
            .get_price_no_older_than(&clock, max_age, &desk.sol_price_feed_id)
            .map_err(|_| OtcError::StalePrice)?;

        // Convert Pyth prices to our 8-decimal format
        let token_usd_8d = convert_pyth_price(token_price.price, token_price.exponent)?;
        let sol_usd_8d = convert_pyth_price(sol_price.price, sol_price.exponent)?;

        // Price deviation check (prevent manipulation/oracle attacks)
        check_price_deviation(desk.token_usd_price_8d, token_usd_8d, max_price_deviation_bps)?;
        check_price_deviation(desk.sol_usd_price_8d, sol_usd_8d, max_price_deviation_bps)?;

        desk.token_usd_price_8d = token_usd_8d;
        desk.sol_usd_price_8d = sol_usd_8d;
        desk.prices_updated_at = current_time;

        emit!(PricesUpdated {
            token_usd_8d,
            sol_usd_8d,
            updated_at: current_time,
            max_age: desk.max_price_age_secs
        });

        Ok(())
    }

    pub fn set_limits(ctx: Context<OnlyOwnerDesk>, min_usd_amount_8d: u64, max_token_per_order: u64, quote_expiry_secs: i64, default_unlock_delay_secs: i64, max_lockup_secs: i64) -> Result<()> {
        require!(min_usd_amount_8d > 0, OtcError::AmountRange);
        require!(max_token_per_order > 0, OtcError::AmountRange);
        require!(quote_expiry_secs >= 60, OtcError::AmountRange); // Minimum 60 seconds to prevent race conditions
        require!(max_lockup_secs >= 0, OtcError::AmountRange);
        require!(default_unlock_delay_secs >= 0 && default_unlock_delay_secs <= max_lockup_secs, OtcError::AmountRange);
        let desk = &mut ctx.accounts.desk;
        desk.min_usd_amount_8d = min_usd_amount_8d;
        desk.max_token_per_order = max_token_per_order;
        desk.quote_expiry_secs = quote_expiry_secs;
        desk.default_unlock_delay_secs = default_unlock_delay_secs;
        desk.max_lockup_secs = max_lockup_secs;
        emit!(LimitsUpdated { min_usd_amount_8d, max_token_per_order, quote_expiry_secs, default_unlock_delay_secs, max_lockup_secs });
        Ok(())
    }

    pub fn set_agent(ctx: Context<OnlyOwnerDesk>, new_agent: Pubkey) -> Result<()> {
        require!(new_agent != Pubkey::default(), OtcError::BadState);
        ctx.accounts.desk.agent = new_agent;
        Ok(())
    }

    pub fn set_restrict_fulfill(ctx: Context<OnlyOwnerDesk>, enabled: bool) -> Result<()> {
        ctx.accounts.desk.restrict_fulfill = enabled;
        emit!(RestrictFulfillUpdated { enabled });
        Ok(())
    }

    pub fn pause(ctx: Context<OnlyOwnerDesk>) -> Result<()> {
        ctx.accounts.desk.paused = true;
        emit!(Paused { paused: true });
        Ok(())
    }

    pub fn unpause(ctx: Context<OnlyOwnerDesk>) -> Result<()> {
        ctx.accounts.desk.paused = false;
        emit!(Paused { paused: false });
        Ok(())
    }

    pub fn set_approver(ctx: Context<OnlyOwnerDesk>, who: Pubkey, allowed: bool) -> Result<()> {
        let approvers = &mut ctx.accounts.desk.approvers;
        if allowed {
            if !approvers.contains(&who) {
                require!(approvers.len() < 32, OtcError::TooManyApprovers);
                approvers.push(who);
            }
        } else if let Some(i) = approvers.iter().position(|x| *x == who) { approvers.remove(i); }
        Ok(())
    }

    /// Deposit tokens into desk treasury for a specific registered token
    pub fn deposit_tokens(ctx: Context<DepositTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, OtcError::AmountRange);
        require!(!ctx.accounts.desk.paused, OtcError::Paused);
        require!(ctx.accounts.token_registry.is_active, OtcError::BadState);
        only_owner(&ctx.accounts.desk, &ctx.accounts.owner.key())?;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.owner_token_ata.to_account_info(),
            to: ctx.accounts.desk_token_treasury.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, amount, ctx.accounts.token_registry.decimals)?;
        // Note: We don't track desk.token_deposited since all tokens are equal
        // and we use TokenRegistry per token. Treasury balance is the source of truth.
        Ok(())
    }

    /// Create an offer for a registered token (using TokenRegistry for pricing)
    /// This replaces the old create_offer that used desk.token_mint
    pub fn create_offer(
        ctx: Context<CreateOffer>,
        token_amount: u64,
        discount_bps: u16,
        currency: u8,
        lockup_secs: i64,
    ) -> Result<()> {
        let desk = &mut ctx.accounts.desk;
        let registry = &ctx.accounts.token_registry;
        
        require!(!desk.paused, OtcError::Paused);
        require!(registry.is_active, OtcError::BadState);
        require!(currency == 0 || currency == 1, OtcError::UnsupportedCurrency);
        require!(token_amount > 0, OtcError::AmountRange);
        require!(discount_bps <= 10000, OtcError::Discount); // Max 100% discount
        
        let now = Clock::get()?.unix_timestamp;
        
        // Use TokenRegistry for price
        require!(registry.token_usd_price_8d > 0, OtcError::NoPrice);
        if registry.prices_updated_at > 0 {
            require!(now - registry.prices_updated_at <= desk.max_price_age_secs, OtcError::StalePrice);
        }

        // Check implied USD value meets minimum
        let total_usd_disc = calc_discounted_usd(token_amount, registry.token_usd_price_8d, registry.decimals, discount_bps)?;
        require!(total_usd_disc >= desk.min_usd_amount_8d, OtcError::MinUsd);

        require!(lockup_secs >= desk.default_unlock_delay_secs && lockup_secs <= desk.max_lockup_secs, OtcError::AmountRange);

        let offer_id = desk.next_offer_id;
        desk.next_offer_id = offer_id.checked_add(1).ok_or(OtcError::Overflow)?;

        let offer_key = ctx.accounts.offer.key();
        let offer = &mut ctx.accounts.offer;
        offer.desk = desk.key();
        offer.consignment_id = 0; // 0 means direct offer (not from consignment)
        offer.token_mint = registry.token_mint;
        offer.token_decimals = registry.decimals;
        offer.id = offer_id;
        offer.beneficiary = ctx.accounts.beneficiary.key();
        offer.token_amount = token_amount;
        offer.discount_bps = discount_bps;
        offer.created_at = now;
        offer.unlock_time = now.checked_add(lockup_secs).ok_or(OtcError::Overflow)?;
        offer.price_usd_per_token_8d = registry.token_usd_price_8d;
        offer.max_price_deviation_bps = 0; 
        offer.sol_usd_price_8d = if currency == 0 { desk.sol_usd_price_8d } else { 0 };
        offer.currency = currency;
        offer.approved = false;
        offer.paid = false;
        offer.fulfilled = false;
        offer.cancelled = false;
        offer.payer = Pubkey::default();
        offer.amount_paid = 0;
        offer.agent_commission_bps = 0; // Direct offers have no agent commission

        emit!(OfferCreated {
            desk: offer.desk,
            offer: offer_key,
            beneficiary: offer.beneficiary,
            token_amount,
            discount_bps,
            currency
        });
        Ok(())
    }

    /// Create an offer from a consignment
    /// agent_commission_bps: For negotiated deals: 25-150 bps (0.25% - 1.5%)
    ///                       For P2P (non-negotiable): ignored, uses desk.p2p_commission_bps (default 0.25%)
    /// Commission is paid to desk.agent from seller proceeds at fulfillment
    pub fn create_offer_from_consignment(
        ctx: Context<CreateOfferFromConsignment>,
        consignment_id: u64,
        token_amount: u64,
        discount_bps: u16,
        currency: u8,
        lockup_secs: i64,
        agent_commission_bps: u16,
    ) -> Result<()> {
        let desk_key = ctx.accounts.desk.key();
        let desk = &mut ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        require!(currency == 0 || currency == 1, OtcError::UnsupportedCurrency);

        let consignment = &mut ctx.accounts.consignment;
        require!(consignment.is_active, OtcError::BadState);
        
        // Enforce is_private: only consigner, owner, agent, or approvers can create offers
        if consignment.is_private {
            let caller = ctx.accounts.beneficiary.key();
            require!(
                caller == consignment.consigner || 
                caller == desk.owner || 
                caller == desk.agent || 
                desk.approvers.contains(&caller),
                OtcError::FulfillRestricted
            );
        }
        
        require!(token_amount >= consignment.min_deal_amount && token_amount <= consignment.max_deal_amount, OtcError::AmountRange);
        require!(token_amount <= consignment.remaining_amount, OtcError::InsuffInv);

        // Determine effective commission for the offer
        let effective_commission_bps: u16 = if consignment.is_negotiable {
            require!(discount_bps >= consignment.min_discount_bps && discount_bps <= consignment.max_discount_bps, OtcError::Discount);
            let lockup_days = lockup_secs / 86400;
            require!(lockup_days >= consignment.min_lockup_days as i64 && lockup_days <= consignment.max_lockup_days as i64, OtcError::LockupTooLong);
            // Negotiated deals: commission must be 25-150 bps (0.25% - 1.5%)
            require!(agent_commission_bps >= 25 && agent_commission_bps <= 150, OtcError::CommissionRange);
            agent_commission_bps
        } else {
            require!(discount_bps == consignment.fixed_discount_bps, OtcError::Discount);
            let lockup_days = lockup_secs / 86400;
            require!(lockup_days == consignment.fixed_lockup_days as i64, OtcError::LockupTooLong);
            // P2P deals: use the configured p2p_commission_bps (default 0.25%)
            // agent_commission_bps parameter is ignored for P2P - uses desk-wide setting
            desk.p2p_commission_bps
        };

        // Use registry price for multi-token support
        let registry = &ctx.accounts.token_registry;
        require!(registry.token_mint == consignment.token_mint, OtcError::BadState); // Ensure registry matches consignment
        
        let price_8d = registry.token_usd_price_8d;
        require!(price_8d > 0, OtcError::NoPrice);
        
        let now = Clock::get()?.unix_timestamp;
        // Check registry price age
        if registry.prices_updated_at > 0 {
            require!(now - registry.prices_updated_at <= desk.max_price_age_secs, OtcError::StalePrice);
        }

        // Check implied USD value meets minimum
        let total_usd_disc = calc_discounted_usd(token_amount, price_8d, registry.decimals, discount_bps)?;
        require!(total_usd_disc >= desk.min_usd_amount_8d, OtcError::MinUsd);

        consignment.remaining_amount = consignment.remaining_amount.checked_sub(token_amount).ok_or(OtcError::Overflow)?;
        if consignment.remaining_amount == 0 {
            consignment.is_active = false;
        }

        let offer_id = desk.next_offer_id;
        desk.next_offer_id = offer_id.checked_add(1).ok_or(OtcError::Overflow)?;

        let offer_key = ctx.accounts.offer.key();
        let beneficiary_key = ctx.accounts.beneficiary.key();
        
        // Non-negotiable offers are auto-approved for P2P (permissionless)
        // Negotiable offers require agent/approver approval
        let auto_approved = !consignment.is_negotiable;
        
        let offer = &mut ctx.accounts.offer;
        
        offer.desk = desk_key;
        offer.consignment_id = consignment_id;
        offer.token_mint = consignment.token_mint;
        offer.token_decimals = registry.decimals;
        offer.id = offer_id;
        offer.beneficiary = beneficiary_key;
        offer.token_amount = token_amount;
        offer.discount_bps = discount_bps;
        offer.created_at = now;
        offer.unlock_time = now.checked_add(lockup_secs).ok_or(OtcError::Overflow)?;
        offer.price_usd_per_token_8d = price_8d;
        offer.max_price_deviation_bps = consignment.max_price_volatility_bps;
        offer.sol_usd_price_8d = if currency == 0 { desk.sol_usd_price_8d } else { 0 };
        offer.currency = currency;
        offer.approved = auto_approved;
        offer.paid = false;
        offer.fulfilled = false;
        offer.cancelled = false;
        offer.payer = Pubkey::default();
        offer.amount_paid = 0;
        offer.agent_commission_bps = effective_commission_bps;

        emit!(OfferCreated {
            desk: offer.desk,
            offer: offer_key,
            beneficiary: beneficiary_key,
            token_amount,
            discount_bps,
            currency
        });
        
        // Emit approval event for non-negotiable (P2P) offers
        if auto_approved {
            emit!(OfferApproved { offer: offer_key, approver: beneficiary_key });
        }
        
        Ok(())
    }

    pub fn withdraw_consignment(ctx: Context<WithdrawConsignment>, _consignment_id: u64) -> Result<()> {
        let consignment = &mut ctx.accounts.consignment;
        require!(consignment.consigner == ctx.accounts.consigner.key(), OtcError::NotOwner);
        require!(consignment.is_active, OtcError::BadState);
        let withdraw_amount = consignment.remaining_amount;
        require!(withdraw_amount > 0, OtcError::AmountRange);

        consignment.is_active = false;
        consignment.remaining_amount = 0;

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.desk_token_treasury.to_account_info(),
            to: ctx.accounts.consigner_token_ata.to_account_info(),
            authority: ctx.accounts.desk_signer.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, withdraw_amount, ctx.accounts.token_mint.decimals)?;
        Ok(())
    }

    pub fn approve_offer(ctx: Context<ApproveOffer>, _offer_id: u64) -> Result<()> {
        let desk = &ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        must_be_approver(desk, &ctx.accounts.approver.key())?;
        
        let offer_key = ctx.accounts.offer.key();
        let approver_key = ctx.accounts.approver.key();
        
        let offer = &mut ctx.accounts.offer;
        require!(!offer.cancelled && !offer.paid, OtcError::BadState);
        require!(!offer.approved, OtcError::AlreadyApproved);
        
        // Non-negotiable offers are P2P (auto-approved at creation) - cannot be manually approved
        let consignment = &ctx.accounts.consignment;
        require!(consignment.is_negotiable, OtcError::NonNegotiableP2P);
        
        offer.approved = true;
        emit!(OfferApproved { offer: offer_key, approver: approver_key });
        Ok(())
    }

    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        let desk = &ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        
        let caller = ctx.accounts.caller.key();
        let offer_key = ctx.accounts.offer.key();
        let now = Clock::get()?.unix_timestamp;
        
        let offer = &mut ctx.accounts.offer;
        require!(!offer.paid && !offer.fulfilled, OtcError::BadState);
        
        if caller == offer.beneficiary {
            let expiry = offer.created_at.checked_add(desk.quote_expiry_secs).ok_or(OtcError::Overflow)?;
            require!(now >= expiry, OtcError::NotExpired);
        } else if caller == desk.owner || caller == desk.agent || desk.approvers.contains(&caller) {
        } else {
            return err!(OtcError::NotApprover);
        }
        
        offer.cancelled = true;
        
        // Restore tokens to consignment if this offer was from one
        // Note: consignment account must be passed via remaining_accounts if needed
        // For now, this is handled in CancelOfferWithConsignment instruction
        
        emit!(OfferCancelled { offer: offer_key, by: caller });
        Ok(())
    }

    /// Cancel an offer that was created from a consignment, restoring tokens
    pub fn cancel_offer_with_consignment(ctx: Context<CancelOfferWithConsignment>) -> Result<()> {
        let desk = &ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        
        let caller = ctx.accounts.caller.key();
        let offer_key = ctx.accounts.offer.key();
        let now = Clock::get()?.unix_timestamp;
        
        let offer = &mut ctx.accounts.offer;
        require!(!offer.paid && !offer.fulfilled && !offer.cancelled, OtcError::BadState);
        require!(offer.consignment_id > 0, OtcError::BadState); // Must be from consignment
        
        if caller == offer.beneficiary {
            let expiry = offer.created_at.checked_add(desk.quote_expiry_secs).ok_or(OtcError::Overflow)?;
            require!(now >= expiry, OtcError::NotExpired);
        } else if caller == desk.owner || caller == desk.agent || desk.approvers.contains(&caller) {
        } else {
            return err!(OtcError::NotApprover);
        }
        
        let token_amount = offer.token_amount;
        offer.cancelled = true;
        
        // Restore tokens to consignment
        let consignment = &mut ctx.accounts.consignment;
        consignment.remaining_amount = consignment.remaining_amount.checked_add(token_amount).ok_or(OtcError::Overflow)?;
        if !consignment.is_active {
            consignment.is_active = true;
        }
        
        emit!(OfferCancelled { offer: offer_key, by: caller });
        Ok(())
    }

    pub fn fulfill_offer_usdc(ctx: Context<FulfillOfferUsdc>, _offer_id: u64) -> Result<()> {
        // Cache keys before mutable borrows to avoid borrow checker issues
        let offer_key = ctx.accounts.offer.key();
        let payer_key = ctx.accounts.payer.key();
        
        let desk = &mut ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        // Removed PDA validation - now using keypairs for offers
        let offer = &mut ctx.accounts.offer;
        require!(offer.currency == 1, OtcError::BadState);
        require!(offer.approved, OtcError::NotApproved);
        require!(!offer.cancelled && !offer.paid && !offer.fulfilled, OtcError::BadState);
        let now = Clock::get()?.unix_timestamp;
        let expiry = offer.created_at.checked_add(desk.quote_expiry_secs).ok_or(OtcError::Overflow)?;
        require!(now <= expiry, OtcError::Expired);
        require!(ctx.accounts.desk_token_treasury.amount >= offer.token_amount, OtcError::InsuffInv);
        if desk.restrict_fulfill {
            let caller = ctx.accounts.payer.key();
            require!(caller == offer.beneficiary || caller == desk.owner || caller == desk.agent || desk.approvers.contains(&caller), OtcError::FulfillRestricted);
        }
        let usd_8d = calc_discounted_usd(offer.token_amount, offer.price_usd_per_token_8d, offer.token_decimals, offer.discount_bps)?;
        let usdc_amount = safe_u128_to_u64(mul_div_ceil_u128(usd_8d as u128, 1_000_000u128, 100_000_000u128)?)?;
        
        // Calculate agent commission (from seller proceeds)
        let commission_usd_8d = usd_8d.checked_mul(offer.agent_commission_bps as u64).ok_or(OtcError::Overflow)?.checked_div(10_000).ok_or(OtcError::Overflow)?;
        let commission_usdc = safe_u128_to_u64(mul_div_u128(commission_usd_8d as u128, 1_000_000u128, 100_000_000u128)?)?;
        
        // Transfer full payment from buyer to desk treasury
        let cpi_accounts = TransferChecked { 
            from: ctx.accounts.payer_usdc_ata.to_account_info(), 
            to: ctx.accounts.desk_usdc_treasury.to_account_info(), 
            authority: ctx.accounts.payer.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, usdc_amount, desk.usdc_decimals)?;
        
        // If there's a commission and agent USDC account is provided, transfer commission to agent
        // SECURITY: Validate agent_usdc_ata owner matches desk.agent to prevent commission theft
        if commission_usdc > 0 {
            if let Some(agent_usdc_ata) = &ctx.accounts.agent_usdc_ata {
                require!(agent_usdc_ata.owner == desk.agent, OtcError::BadState);
                // Transfer commission from desk treasury to agent (desk_signer authorizes)
                let cpi_accounts_commission = TransferChecked { 
                    from: ctx.accounts.desk_usdc_treasury.to_account_info(), 
                    to: agent_usdc_ata.to_account_info(), 
                    authority: ctx.accounts.desk_signer.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                };
                let cpi_ctx_commission = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_commission);
                transfer_checked(cpi_ctx_commission, commission_usdc, desk.usdc_decimals)?;
                emit!(AgentCommissionPaid { offer: offer_key, agent: desk.agent, amount: commission_usdc, currency: 1 });
            }
        }
        
        offer.amount_paid = usdc_amount; offer.payer = payer_key; offer.paid = true;
        // Note: desk.token_reserved is deprecated since all tokens are equal now
        emit!(OfferPaid { offer: offer_key, payer: payer_key, amount: usdc_amount, currency: 1 });
        Ok(())
    }

    pub fn fulfill_offer_sol(ctx: Context<FulfillOfferSol>, _offer_id: u64) -> Result<()> {
        // Cache keys before mutable borrows to avoid borrow checker issues
        let offer_key = ctx.accounts.offer.key();
        let payer_key = ctx.accounts.payer.key();
        
        let desk_ai = ctx.accounts.desk.to_account_info();
        let desk_key = desk_ai.key();
        let desk = &mut ctx.accounts.desk;
        let agent_key = desk.agent;
        require!(!desk.paused, OtcError::Paused);
        // Removed PDA validation - now using keypairs for offers
        let offer = &mut ctx.accounts.offer;
        require!(offer.currency == 0, OtcError::BadState);
        require!(offer.approved, OtcError::NotApproved);
        require!(!offer.cancelled && !offer.paid && !offer.fulfilled, OtcError::BadState);
        let now = Clock::get()?.unix_timestamp;
        let expiry = offer.created_at.checked_add(desk.quote_expiry_secs).ok_or(OtcError::Overflow)?;
        require!(now <= expiry, OtcError::Expired);
        require!(ctx.accounts.desk_token_treasury.amount >= offer.token_amount, OtcError::InsuffInv);
        if desk.restrict_fulfill {
            let caller = ctx.accounts.payer.key();
            require!(caller == offer.beneficiary || caller == desk.owner || caller == desk.agent || desk.approvers.contains(&caller), OtcError::FulfillRestricted);
        }
        let usd_8d = calc_discounted_usd(offer.token_amount, offer.price_usd_per_token_8d, offer.token_decimals, offer.discount_bps)?;
        let sol_usd = if offer.sol_usd_price_8d > 0 { offer.sol_usd_price_8d } else { desk.sol_usd_price_8d };
        require!(sol_usd > 0, OtcError::NoPrice);
        let lamports_req = safe_u128_to_u64(mul_div_ceil_u128(usd_8d as u128, 1_000_000_000u128, sol_usd as u128)?)?;
        
        // Calculate agent commission (from seller proceeds)
        let commission_usd_8d = usd_8d.checked_mul(offer.agent_commission_bps as u64).ok_or(OtcError::Overflow)?.checked_div(10_000).ok_or(OtcError::Overflow)?;
        let commission_lamports = safe_u128_to_u64(mul_div_u128(commission_usd_8d as u128, 1_000_000_000u128, sol_usd as u128)?)?;
        
        // Transfer full payment from buyer to desk
        let ix = anchor_lang::solana_program::system_instruction::transfer(&ctx.accounts.payer.key(), &desk_key, lamports_req);
        anchor_lang::solana_program::program::invoke(&ix, &[
            ctx.accounts.payer.to_account_info(),
            desk_ai.clone(),
            ctx.accounts.system_program.to_account_info(),
        ])?;
        
        // If there's a commission and agent account is provided, transfer commission to agent
        // SECURITY: Validate agent account matches desk.agent to prevent commission theft
        if commission_lamports > 0 {
            if let Some(agent_account) = &ctx.accounts.agent {
                require!(agent_account.key() == agent_key, OtcError::BadState);
                // Transfer commission from desk to agent (desk_signer authorizes)
                **desk_ai.try_borrow_mut_lamports()? -= commission_lamports;
                **agent_account.to_account_info().try_borrow_mut_lamports()? += commission_lamports;
                emit!(AgentCommissionPaid { offer: offer_key, agent: agent_key, amount: commission_lamports, currency: 0 });
            }
        }
        
        offer.amount_paid = lamports_req; offer.payer = payer_key; offer.paid = true;
        // Note: desk.token_reserved is deprecated since all tokens are equal now
        emit!(OfferPaid { offer: offer_key, payer: payer_key, amount: lamports_req, currency: 0 });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, _offer_id: u64) -> Result<()> {
        // Desk keypair signs to authorize token transfer
        let desk = &ctx.accounts.desk;
        require!(!desk.paused, OtcError::Paused);
        require!(ctx.accounts.desk_signer.key() == desk.key(), OtcError::NotOwner);
        
        let offer_key = ctx.accounts.offer.key();
        let offer = &mut ctx.accounts.offer;
        require!(ctx.accounts.beneficiary.key() == offer.beneficiary, OtcError::NotOwner);
        require!(offer.paid && !offer.cancelled && !offer.fulfilled, OtcError::BadState);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= offer.unlock_time, OtcError::Locked);
        
        // Transfer tokens from desk treasury to beneficiary (desk_signer authorizes)
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.desk_token_treasury.to_account_info(),
            to: ctx.accounts.beneficiary_token_ata.to_account_info(),
            authority: ctx.accounts.desk_signer.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, offer.token_amount, offer.token_decimals)?;
        
        // Note: desk.token_reserved is deprecated - multi-token model uses per-token treasury balances
        offer.fulfilled = true;
        emit!(TokensClaimed { offer: offer_key, beneficiary: offer.beneficiary, amount: offer.token_amount });
        Ok(())
    }

    /// Withdraw tokens from desk treasury for any registered token
    pub fn withdraw_tokens(ctx: Context<WithdrawTokens>, amount: u64) -> Result<()> {
        // Desk keypair signs to authorize withdrawal
        only_owner(&ctx.accounts.desk, &ctx.accounts.owner.key())?;
        require!(ctx.accounts.desk_signer.key() == ctx.accounts.desk.key(), OtcError::NotOwner);
        require!(ctx.accounts.token_registry.is_active, OtcError::BadState);
        // No reserved amount check - multi-token model uses treasury balance as source of truth
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.desk_token_treasury.to_account_info(),
            to: ctx.accounts.owner_token_ata.to_account_info(),
            authority: ctx.accounts.desk_signer.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, amount, ctx.accounts.token_registry.decimals)?;
        Ok(())
    }

    pub fn withdraw_usdc(ctx: Context<WithdrawUsdc>, amount: u64) -> Result<()> {
        // Desk keypair signs to authorize withdrawal
        only_owner(&ctx.accounts.desk, &ctx.accounts.owner.key())?;
        require!(ctx.accounts.desk_signer.key() == ctx.accounts.desk.key(), OtcError::NotOwner);
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.desk_usdc_treasury.to_account_info(),
            to: ctx.accounts.to_usdc_ata.to_account_info(),
            authority: ctx.accounts.desk_signer.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, amount, ctx.accounts.desk.usdc_decimals)?;
        Ok(())
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>, lamports: u64) -> Result<()> {
        // Desk keypair signs to authorize withdrawal
        only_owner(&ctx.accounts.desk, &ctx.accounts.owner.key())?;
        require!(ctx.accounts.desk_signer.key() == ctx.accounts.desk.key(), OtcError::NotOwner);
        // keep rent-exempt minimum
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(8 + Desk::SIZE);
        let current = ctx.accounts.desk.to_account_info().lamports();
        let after = current.checked_sub(lamports).ok_or(OtcError::Overflow)?;
        require!(after >= min_rent, OtcError::BadState);
        
        **ctx.accounts.desk.to_account_info().try_borrow_mut_lamports()? -= lamports;
        **ctx.accounts.to.to_account_info().try_borrow_mut_lamports()? += lamports;
        Ok(())
    }

    pub fn set_emergency_refund(ctx: Context<OnlyOwnerDesk>, enabled: bool, deadline_secs: i64) -> Result<()> {
        let desk = &mut ctx.accounts.desk;
        desk.emergency_refund_enabled = enabled;
        desk.emergency_refund_deadline_secs = deadline_secs;
        Ok(())
    }

    /// Set P2P commission rate for non-negotiable fixed-price deals
    /// Default is 25 bps (0.25%), max 500 bps (5%)
    pub fn set_p2p_commission(ctx: Context<OnlyOwnerDesk>, bps: u16) -> Result<()> {
        require!(bps <= 500, OtcError::CommissionRange); // Max 5% for P2P
        let desk = &mut ctx.accounts.desk;
        desk.p2p_commission_bps = bps;
        Ok(())
    }

    pub fn emergency_refund_sol(ctx: Context<EmergencyRefundSol>, _offer_id: u64) -> Result<()> {
        let desk = &ctx.accounts.desk;
        require!(desk.emergency_refund_enabled, OtcError::BadState);
        
        let offer = &mut ctx.accounts.offer;
        require!(offer.paid && !offer.fulfilled && !offer.cancelled, OtcError::BadState);
        require!(offer.currency == 0, OtcError::BadState); // SOL payment
        
        let now = Clock::get()?.unix_timestamp;
        let deadline = offer.created_at.checked_add(desk.emergency_refund_deadline_secs).ok_or(OtcError::Overflow)?;
        let unlock_deadline = offer.unlock_time.checked_add(30 * 86400).ok_or(OtcError::Overflow)?; // 30 days after unlock
        
        require!(now >= deadline || now >= unlock_deadline, OtcError::TooEarlyForRefund);
        
        let caller = ctx.accounts.caller.key();
        require!(
            caller == offer.payer || 
            caller == offer.beneficiary || 
            caller == desk.owner || 
            caller == desk.agent || 
            desk.approvers.contains(&caller),
            OtcError::NotOwner
        );
        
        // Mark as cancelled to prevent double refund
        offer.cancelled = true;
        
        // Note: desk.token_reserved is deprecated - multi-token model doesn't use it
        
        // Refund SOL to payer
        **ctx.accounts.desk.to_account_info().try_borrow_mut_lamports()? -= offer.amount_paid;
        **ctx.accounts.payer_refund.to_account_info().try_borrow_mut_lamports()? += offer.amount_paid;
        
        Ok(())
    }

    pub fn emergency_refund_usdc(ctx: Context<EmergencyRefundUsdc>, _offer_id: u64) -> Result<()> {
        let desk = &ctx.accounts.desk;
        require!(desk.emergency_refund_enabled, OtcError::BadState);
        
        let offer = &mut ctx.accounts.offer;
        require!(offer.paid && !offer.fulfilled && !offer.cancelled, OtcError::BadState);
        require!(offer.currency == 1, OtcError::BadState); // USDC payment
        
        let now = Clock::get()?.unix_timestamp;
        let deadline = offer.created_at.checked_add(desk.emergency_refund_deadline_secs).ok_or(OtcError::Overflow)?;
        let unlock_deadline = offer.unlock_time.checked_add(30 * 86400).ok_or(OtcError::Overflow)?;
        
        require!(now >= deadline || now >= unlock_deadline, OtcError::TooEarlyForRefund);
        
        let caller = ctx.accounts.caller.key();
        require!(
            caller == offer.payer || 
            caller == offer.beneficiary || 
            caller == desk.owner || 
            caller == desk.agent || 
            desk.approvers.contains(&caller),
            OtcError::NotOwner
        );
        
        // Mark as cancelled
        offer.cancelled = true;
        
        // Note: desk.token_reserved is deprecated - multi-token model doesn't use it
        
        // Refund USDC to payer
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.desk_usdc_treasury.to_account_info(),
            to: ctx.accounts.payer_usdc_refund.to_account_info(),
            authority: ctx.accounts.desk_signer.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, offer.amount_paid, ctx.accounts.desk.usdc_decimals)?;
        
        Ok(())
    }

}

#[derive(Accounts)]
pub struct InitDesk<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: Agent can be any account
    pub agent: UncheckedAccount<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    #[account(init, payer = payer, space = 8 + Desk::SIZE)]
    pub desk: Account<'info, Desk>,
}

#[derive(Accounts)]
pub struct RegisterToken<'info> {
    pub desk: Account<'info, Desk>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, 
        payer = payer, 
        space = 8 + TokenRegistry::SIZE,
        seeds = [b"registry", desk.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub token_registry: Account<'info, TokenRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateConsignment<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut)]
    pub consigner: Signer<'info>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, constraint = consigner_token_ata.mint == token_mint.key() @ OtcError::BadState, constraint = consigner_token_ata.owner == consigner.key() @ OtcError::BadState)]
    pub consigner_token_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = desk_token_treasury.mint == token_mint.key() @ OtcError::BadState, constraint = desk_token_treasury.owner == desk.key() @ OtcError::BadState)]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = consigner, space = 8 + Consignment::SIZE)]
    pub consignment: Account<'info, Consignment>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateOfferFromConsignment<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = consignment.desk == desk.key() @ OtcError::BadState)]
    pub consignment: Account<'info, Consignment>,
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    #[account(init_if_needed, payer = beneficiary, space = 8 + Offer::SIZE)]
    pub offer: Account<'info, Offer>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTokenOracleFeed<'info> {
    #[account(mut, constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub desk: Account<'info, Desk>,
    #[account(constraint = owner.key() == desk.owner @ OtcError::NotOwner)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetTokenPoolConfig<'info> {
    #[account(mut, constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub desk: Account<'info, Desk>,
    pub signer: Signer<'info>, // Can be owner or registered_by
}

#[derive(Accounts)]
pub struct SetManualTokenPrice<'info> {
    #[account(mut, constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub desk: Account<'info, Desk>,
    #[account(constraint = owner.key() == desk.owner @ OtcError::NotOwner)]
    pub owner: Signer<'info>,
}

/// Configure pool oracle security settings (owner only)
#[derive(Accounts)]
pub struct ConfigurePoolOracle<'info> {
    #[account(mut, constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub desk: Account<'info, Desk>,
    #[account(constraint = owner.key() == desk.owner @ OtcError::NotOwner)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTokenPriceFromPool<'info> {
    #[account(mut)]
    pub token_registry: Account<'info, TokenRegistry>,
    /// CHECK: Validated against registry.pool_address and program ID is verified in instruction
    #[account(constraint = pool.key() == token_registry.pool_address @ OtcError::BadState)]
    pub pool: UncheckedAccount<'info>,
    /// Token vault (vault_a) - contains the token being priced
    /// NOTE: On mainnet Raydium/Orca, vaults are owned by pool authority PDAs, not pool address
    /// The vault must match the token mint in the registry
    #[account(constraint = vault_a.mint == token_registry.token_mint @ OtcError::BadState)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    /// Quote vault (vault_b) - contains USDC or SOL
    /// NOTE: Quote vault ownership is verified via AMM program ID check in instruction logic
    pub vault_b: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// PumpSwap / Pump.fun bonding curve price update
#[derive(Accounts)]
pub struct UpdateTokenPriceFromPumpswap<'info> {
    #[account(mut, constraint = token_registry.pool_type == PoolType::PumpSwap @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    /// CHECK: Validated against registry.pool_address (bonding curve account)
    #[account(constraint = bonding_curve.key() == token_registry.pool_address @ OtcError::BadState)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: SOL vault - must be owned by bonding curve program or validated externally
    /// In PumpSwap, the bonding curve account itself holds SOL
    #[account(constraint = sol_vault.key() == token_registry.pool_address @ OtcError::BadState)]
    pub sol_vault: UncheckedAccount<'info>,
    /// Token vault holding the bonding curve's tokens - must match token mint and be owned by pool
    #[account(constraint = token_vault.mint == token_registry.token_mint @ OtcError::BadState)]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct UpdateTokenPriceFromPyth<'info> {
    #[account(mut, constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub desk: Account<'info, Desk>,
    pub price_feed: Account<'info, PriceUpdateV2>,
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct OnlyOwnerDesk<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub desk: Account<'info, Desk>,
}

#[derive(Accounts)]
pub struct UpdatePricesFromPyth<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    /// Pyth price feed account for token/USD
    pub token_price_feed: Account<'info, PriceUpdateV2>,
    /// Pyth price feed account for SOL/USD
    pub sol_price_feed: Account<'info, PriceUpdateV2>,
    /// Anyone can update prices from oracle
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositTokens<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    /// Token registry - must belong to this desk
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, constraint = owner_token_ata.mint == token_registry.token_mint, constraint = owner_token_ata.owner == owner.key())]
    pub owner_token_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = desk_token_treasury.mint == token_registry.token_mint, constraint = desk_token_treasury.owner == desk.key())]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    /// Token registry for pricing - must belong to this desk
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    #[account(mut, constraint = desk_token_treasury.mint == token_registry.token_mint, constraint = desk_token_treasury.owner == desk.key())]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    #[account(init_if_needed, payer = beneficiary, space = 8 + Offer::SIZE)]
    pub offer: Account<'info, Offer>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveOffer<'info> {
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    /// Consignment account - required for negotiable check
    #[account(constraint = consignment.desk == desk.key() @ OtcError::BadState, constraint = consignment.id == offer.consignment_id @ OtcError::BadState)]
    pub consignment: Account<'info, Consignment>,
    pub approver: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelOfferWithConsignment<'info> {
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    #[account(mut, constraint = consignment.desk == desk.key() @ OtcError::BadState, constraint = consignment.id == offer.consignment_id @ OtcError::BadState)]
    pub consignment: Account<'info, Consignment>,
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct FulfillOfferUsdc<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    /// Token treasury - must match the token_mint in the offer
    #[account(mut, constraint = desk_token_treasury.mint == offer.token_mint, constraint = desk_token_treasury.owner == desk.key())]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = desk_usdc_treasury.mint == desk.usdc_mint, constraint = desk_usdc_treasury.owner == desk.key())]
    pub desk_usdc_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = payer_usdc_ata.mint == desk.usdc_mint, constraint = payer_usdc_ata.owner == payer.key())]
    pub payer_usdc_ata: InterfaceAccount<'info, TokenAccount>,
    /// Agent USDC account for receiving commission (optional - only needed if commission > 0)
    /// SECURITY: Validated in instruction to be owned by desk.agent to prevent commission theft
    #[account(mut)]
    pub agent_usdc_ata: Option<InterfaceAccount<'info, TokenAccount>>,
    /// Desk signer for authorizing commission transfer from treasury
    pub desk_signer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillOfferSol<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    /// Token treasury - must match the token_mint in the offer
    #[account(mut, constraint = desk_token_treasury.mint == offer.token_mint, constraint = desk_token_treasury.owner == desk.key())]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    /// Agent account for receiving SOL commission (optional - only needed if commission > 0)
    /// CHECK: This is the agent's wallet address, we're just sending SOL to it
    #[account(mut)]
    pub agent: Option<AccountInfo<'info>>,
    /// Desk signer for authorizing lamport transfer
    pub desk_signer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// Treasury must match the token in the offer and be owned by desk
    #[account(mut, constraint = desk_token_treasury.mint == offer.token_mint, constraint = desk_token_treasury.owner == desk.key() @ OtcError::BadState)]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = beneficiary_token_ata.mint == offer.token_mint, constraint = beneficiary_token_ata.owner == offer.beneficiary @ OtcError::BadState)]
    pub beneficiary_token_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Validated against offer.beneficiary in instruction
    pub beneficiary: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub desk: Account<'info, Desk>,
    /// Token registry - must belong to this desk
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]
    pub token_registry: Account<'info, TokenRegistry>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = desk_token_treasury.mint == token_registry.token_mint, constraint = desk_token_treasury.owner == desk.key() @ OtcError::BadState)]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    /// SECURITY: Validate owner_token_ata is owned by the owner signer to prevent withdrawal theft
    #[account(mut, constraint = owner_token_ata.mint == token_registry.token_mint, constraint = owner_token_ata.owner == owner.key() @ OtcError::BadState)]
    pub owner_token_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawUsdc<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub desk: Account<'info, Desk>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = desk_signer.key() == desk.key() @ OtcError::NotOwner)]
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = desk_usdc_treasury.mint == desk.usdc_mint @ OtcError::BadState, constraint = desk_usdc_treasury.owner == desk.key() @ OtcError::BadState)]
    pub desk_usdc_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = to_usdc_ata.mint == desk.usdc_mint @ OtcError::BadState)]
    pub to_usdc_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawConsignment<'info> {
    #[account(mut, constraint = consignment.desk == desk.key() @ OtcError::BadState)]
    pub consignment: Account<'info, Consignment>,
    pub desk: Account<'info, Desk>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = desk_signer.key() == desk.key() @ OtcError::NotOwner)]
    pub desk_signer: Signer<'info>,
    #[account(mut)]
    pub consigner: Signer<'info>,
    #[account(mut, constraint = desk_token_treasury.mint == consignment.token_mint @ OtcError::BadState, constraint = desk_token_treasury.owner == desk.key() @ OtcError::BadState)]
    pub desk_token_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = consigner_token_ata.mint == consignment.token_mint @ OtcError::BadState, constraint = consigner_token_ata.owner == consigner.key() @ OtcError::BadState)]
    pub consigner_token_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    pub desk_signer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: system account
    #[account(mut)]
    pub to: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyRefundSol<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    pub caller: Signer<'info>,
    /// CHECK: payer to refund - validated against offer.payer in instruction
    #[account(mut, constraint = payer_refund.key() == offer.payer @ OtcError::BadState)]
    pub payer_refund: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyRefundUsdc<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub caller: Signer<'info>,
    #[account(mut, constraint = desk_usdc_treasury.owner == desk.key() @ OtcError::BadState)]
    pub desk_usdc_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = payer_usdc_refund.owner == offer.payer @ OtcError::BadState)]
    pub payer_usdc_refund: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
pub struct Desk {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_decimals: u8,
    pub min_usd_amount_8d: u64,
    pub quote_expiry_secs: i64,
    pub max_price_age_secs: i64,
    pub restrict_fulfill: bool,
    pub approvers: Vec<Pubkey>, // max 32
    pub next_consignment_id: u64,
    pub next_offer_id: u64,
    pub paused: bool,
    pub sol_price_feed_id: [u8; 32],
    pub sol_usd_price_8d: u64,
    pub prices_updated_at: i64,
    // Deprecated fields - kept for account size
    pub token_mint: Pubkey,
    pub token_decimals: u8,
    pub token_deposited: u64,
    pub token_reserved: u64,
    pub token_price_feed_id: [u8; 32],
    pub token_usd_price_8d: u64,
    pub default_unlock_delay_secs: i64,
    pub max_lockup_secs: i64,
    pub max_token_per_order: u64,
    pub emergency_refund_enabled: bool,
    pub emergency_refund_deadline_secs: i64,
    pub p2p_commission_bps: u16,
}

impl Desk { pub const SIZE: usize = 32+32+32+1+8+8+8+1+4+(32*32)+8+8+1+32+8+8+32+1+8+8+32+8+8+8+8+1+8+2; } // +2 for p2p_commission_bps

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum PoolType { #[default] None, Raydium, Orca, PumpSwap }

#[account]
pub struct TokenRegistry {
    pub desk: Pubkey,
    pub token_mint: Pubkey,
    pub decimals: u8,
    pub price_feed_id: [u8; 32],
    pub pool_address: Pubkey,
    pub pool_type: PoolType,
    pub is_active: bool,
    pub token_usd_price_8d: u64,
    pub prices_updated_at: i64,
    pub registered_by: Pubkey,
    // EMA fields for manipulation resistance
    pub min_liquidity: u64,
    pub twap_cumulative_price: u128, // deprecated
    pub twap_last_timestamp: i64,
    pub twap_last_price: u64,
    pub max_twap_deviation_bps: u16,
    pub min_update_interval_secs: i64,
}

impl TokenRegistry { 
    // 32+32+1+32+32+1+1+8+8+32 = 179 (original)
    // + 8 (min_liquidity) + 16 (twap_cumulative) + 8 (twap_last_ts) + 8 (twap_last_price) + 2 (max_twap_dev) + 8 (min_update) = 50
    // Total = 229
    pub const SIZE: usize = 32+32+1+32+32+1+1+8+8+32+8+16+8+8+2+8;
}

#[account]
pub struct Consignment {
    pub desk: Pubkey,
    pub id: u64,
    pub token_mint: Pubkey,
    pub consigner: Pubkey,
    pub total_amount: u64,
    pub remaining_amount: u64,
    pub is_negotiable: bool,
    pub fixed_discount_bps: u16,
    pub fixed_lockup_days: u32,
    pub min_discount_bps: u16,
    pub max_discount_bps: u16,
    pub min_lockup_days: u32,
    pub max_lockup_days: u32,
    pub min_deal_amount: u64,
    pub max_deal_amount: u64,
    pub is_fractionalized: bool,
    pub is_private: bool,
    pub max_price_volatility_bps: u16,
    pub max_time_to_execute_secs: i64,
    pub is_active: bool,
    pub created_at: i64,
}

impl Consignment { pub const SIZE: usize = 32+8+32+32+8+8+1+2+4+2+2+4+4+8+8+1+1+2+8+1+8; }

#[account]
pub struct Offer {
    pub desk: Pubkey,
    pub consignment_id: u64,
    pub token_mint: Pubkey,
    pub token_decimals: u8,  // Store decimals so fulfillment doesn't need TokenRegistry
    pub id: u64,
    pub beneficiary: Pubkey,
    pub token_amount: u64,
    pub discount_bps: u16,
    pub created_at: i64,
    pub unlock_time: i64,
    pub price_usd_per_token_8d: u64,
    pub max_price_deviation_bps: u16,
    pub sol_usd_price_8d: u64,
    pub currency: u8,
    pub approved: bool,
    pub paid: bool,
    pub fulfilled: bool,
    pub cancelled: bool,
    pub payer: Pubkey,
    pub amount_paid: u64,
    pub agent_commission_bps: u16, // p2p_commission_bps for P2P (default 0.25%), 25-150 for negotiated deals
}

impl Offer { pub const SIZE: usize = 32+8+32+1+8+32+8+2+8+8+8+2+8+1+1+1+1+1+32+8+2; } // +2 for agent_commission_bps

fn only_owner(desk: &Desk, who: &Pubkey) -> Result<()> { require!(*who == desk.owner, OtcError::NotOwner); Ok(()) }
fn must_be_approver(desk: &Desk, who: &Pubkey) -> Result<()> { require!((*who == desk.agent) || desk.approvers.contains(who), OtcError::NotApprover); Ok(()) }
fn pow10(exp: u32) -> u128 { 10u128.pow(exp) }
fn mul_div_u128(a: u128, b: u128, d: u128) -> Result<u128> { a.checked_mul(b).and_then(|x| x.checked_div(d)).ok_or(OtcError::Overflow.into()) }
fn mul_div_ceil_u128(a: u128, b: u128, d: u128) -> Result<u128> { let prod = a.checked_mul(b).ok_or(OtcError::Overflow)?; let q = prod / d; let r = prod % d; Ok(if r == 0 { q } else { q + 1 }) }
fn safe_u128_to_u64(value: u128) -> Result<u64> { u64::try_from(value).map_err(|_| OtcError::Overflow.into()) }

fn check_price_deviation(old_price: u64, new_price: u64, max_deviation_bps: u16) -> Result<()> {
    if old_price == 0 || max_deviation_bps == 0 {
        return Ok(());
    }
    let diff = if new_price > old_price { new_price - old_price } else { old_price - new_price };
    let max_deviation = (old_price as u128 * max_deviation_bps as u128) / 10000u128;
    require!(diff as u128 <= max_deviation, OtcError::PriceDeviationTooLarge);
    Ok(())
}

fn calc_discounted_usd(token_amount: u64, price_8d: u64, decimals: u8, discount_bps: u16) -> Result<u64> {
    let token_dec = decimals as u32;
    let usd_8d = safe_u128_to_u64(mul_div_u128(token_amount as u128, price_8d as u128, pow10(token_dec) as u128)?)?;
    usd_8d.checked_mul((10_000 - discount_bps as u64) as u64)
        .ok_or(OtcError::Overflow)?
        .checked_div(10_000)
        .ok_or(OtcError::Overflow.into())
}

// AMM Program IDs (mainnet)
const RAYDIUM_AMM_V4: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CPMM: &str = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const RAYDIUM_CLMM: &str = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const ORCA_WHIRLPOOL: &str = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const PUMPSWAP_PROGRAM: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

fn is_raydium_program(program_id: &Pubkey) -> bool {
    matches!(program_id.to_string().as_str(), RAYDIUM_AMM_V4 | RAYDIUM_CPMM | RAYDIUM_CLMM)
}
fn is_orca_program(program_id: &Pubkey) -> bool { program_id.to_string() == ORCA_WHIRLPOOL }
fn is_pumpswap_program(program_id: &Pubkey) -> bool { program_id.to_string() == PUMPSWAP_PROGRAM }

fn convert_pyth_price(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, OtcError::BadPrice);
    let exp_diff = 8i32.checked_sub(exponent).ok_or(OtcError::Overflow)?;
    require!(exp_diff <= 38 && exp_diff >= -38, OtcError::BadPrice);
    #[allow(clippy::cast_sign_loss)]
    let price_u128 = price as u128;
    let result = if exp_diff >= 0 {
        #[allow(clippy::cast_sign_loss)]
        price_u128.checked_mul(10u128.pow(exp_diff as u32)).ok_or(OtcError::Overflow)?
    } else {
        #[allow(clippy::cast_sign_loss)]
        price_u128.checked_div(10u128.pow((-exp_diff) as u32)).ok_or(OtcError::Overflow)?
    };
    u64::try_from(result).map_err(|_| OtcError::Overflow.into())
}

#[error_code]
pub enum OtcError {
    #[msg("USDC must have 6 decimals")] UsdcDecimals,
    #[msg("Amount out of range")] AmountRange,
    #[msg("Discount too high")] Discount,
    #[msg("Price data is stale")] StalePrice,
    #[msg("No price set")] NoPrice,
    #[msg("Minimum USD not met")] MinUsd,
    #[msg("Insufficient token inventory")] InsuffInv,
    #[msg("Overflow")] Overflow,
    #[msg("Lockup too long")] LockupTooLong,
    #[msg("Bad state")] BadState,
    #[msg("Already approved")] AlreadyApproved,
    #[msg("Not approved")] NotApproved,
    #[msg("Quote expired")] Expired,
    #[msg("Fulfill restricted")] FulfillRestricted,
    #[msg("Locked")] Locked,
    #[msg("Not owner")] NotOwner,
    #[msg("Not approver")] NotApprover,
    #[msg("Too many approvers")] TooManyApprovers,
    #[msg("Unsupported currency")] UnsupportedCurrency,
    #[msg("Paused")] Paused,
    #[msg("Not expired")] NotExpired,
    #[msg("Bad price from oracle")] BadPrice,
    #[msg("Price deviation too large")] PriceDeviationTooLarge,
    #[msg("Oracle feed IDs not configured")] FeedNotConfigured,
    #[msg("Too early for emergency refund")] TooEarlyForRefund,
    #[msg("Invalid pool program ID")] InvalidPoolProgram,
    #[msg("Insufficient pool liquidity")] InsufficientLiquidity,
    #[msg("TWAP deviation too large")] TwapDeviationTooLarge,
    #[msg("Price update too frequent")] UpdateTooFrequent,
    #[msg("Commission must be 0 for P2P or 25-150 bps for negotiated")] CommissionRange,
    #[msg("Non-negotiable offers are P2P (auto-approved)")] NonNegotiableP2P,
}


