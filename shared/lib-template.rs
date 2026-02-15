//! # Shared Crate Template
//!
//! Common domain types and validation shared between the server engine (native Rust)
//! and the client engine (WASM). This crate is the single source of truth for domain
//! logic that must agree on both sides of the WebSocket boundary.
//!
//! ## Architecture
//!
//! ```text
//! shared crate (this)
//!   |
//!   +-- server engine (depends on shared)
//!   |     - Uses types for ingest + tick
//!   |     - Serializes to FlatBuffer via schema/*.fbs
//!   |
//!   +-- client engine (depends on shared, compiled to WASM)
//!         - Uses types for deserialization + rendering
//!         - wasm_bindgen lives in the client crate, NOT here
//! ```
//!
//! ## What belongs here
//!
//! - Domain types (Side, PriceLevel, etc.)
//! - Validation functions (price > 0, size > 0)
//! - Constants shared between server and client
//! - Pure computation helpers (no I/O, no WASM bindings)
//!
//! ## What does NOT belong here
//!
//! - `#[wasm_bindgen]` attributes (those go in the client engine crate)
//! - Server-only logic (WebSocket handling, broadcast, etc.)
//! - FlatBuffer generated code (generated per-target from schema/*.fbs)
//! - I/O, networking, or platform-specific code

use serde::{Deserialize, Serialize};

// ============================================
// Constants
//
// Shared between server and client so both sides
// agree on limits and precision. Change these in
// one place and both targets pick them up.
// ============================================

/// Maximum depth levels for orderbook bids/asks.
/// Controls the size of FlatBuffer vectors and
/// client-side rendering arrays.
pub const MAX_DEPTH: usize = 25;

/// Minimum tick size for price rounding.
/// Prices are rounded to this increment before
/// comparison or display. Prevents floating-point
/// noise from creating false price levels.
pub const TICK_SIZE: f64 = 0.01;

/// Tolerance for floating-point comparisons.
/// Two prices within EPSILON of each other are
/// considered equal. Used in deduplication and
/// level aggregation.
pub const EPSILON: f64 = 1e-10;

/// Maximum symbol length (bytes). Used for validation
/// before sending commands or processing subscriptions.
pub const MAX_SYMBOL_LEN: usize = 32;

// ============================================
// Domain Types
//
// These types are the shared contract. Both the
// server engine's ingest/tick and the client engine's
// deserialization/rendering use them.
//
// Keep them simple: no methods with side effects,
// no platform-specific derives. serde is the only
// external dependency (for optional JSON serialization
// in tests or REST endpoints).
// ============================================

/// Market side: bid (buy) or ask (sell).
///
/// Used in orderbook processing, trade classification,
/// and UI color mapping (bid = green, ask = red by convention).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    Bid,
    Ask,
}

impl Side {
    /// Returns the opposite side. Useful for matching
    /// incoming trades against the orderbook.
    pub fn opposite(self) -> Self {
        match self {
            Side::Bid => Side::Ask,
            Side::Ask => Side::Bid,
        }
    }
}

/// A single price level in an orderbook.
///
/// Matches the FlatBuffers `PriceLevel` struct in `schema/orderbook.fbs`:
///   struct PriceLevel { price: double; size: double; }
///
/// This Rust struct is used for internal processing. The FlatBuffer struct
/// is used for zero-copy serialization over the wire.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PriceLevel {
    /// Price at this level (must be > 0)
    pub price: f64,
    /// Aggregate size at this level (must be >= 0; 0 means level removed)
    pub size: f64,
}

impl PriceLevel {
    /// Create a new price level. Returns None if price <= 0 or size < 0.
    pub fn new(price: f64, size: f64) -> Option<Self> {
        if validate_price(price) && validate_size(size) {
            Some(Self { price, size })
        } else {
            None
        }
    }

    /// Whether this level has been removed (size dropped to zero).
    pub fn is_removed(&self) -> bool {
        self.size < EPSILON
    }
}

/// A trade event with price, size, and side.
///
/// Used for trade classification, VWAP computation,
/// and time-series data in the client engine.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Trade {
    /// Trade price (must be > 0)
    pub price: f64,
    /// Trade size (must be > 0)
    pub size: f64,
    /// Aggressor side: Bid means buyer was the taker
    pub side: Side,
    /// Exchange timestamp in milliseconds since epoch
    pub timestamp_ms: u64,
}

// ============================================
// Validation Helpers
//
// Used by both server (validating exchange data)
// and client (validating user commands). Keeping
// validation in the shared crate ensures both sides
// reject the same invalid inputs.
// ============================================

/// Validate a price value: must be finite and positive.
pub fn validate_price(price: f64) -> bool {
    price.is_finite() && price > 0.0
}

/// Validate a size value: must be finite and non-negative.
/// A size of 0.0 is valid (indicates level removal in orderbook deltas).
pub fn validate_size(size: f64) -> bool {
    size.is_finite() && size >= 0.0
}

/// Validate a symbol string: non-empty, within length limit, ASCII alphanumeric
/// with common separators (dash, underscore, slash, dot).
pub fn validate_symbol(symbol: &str) -> bool {
    !symbol.is_empty()
        && symbol.len() <= MAX_SYMBOL_LEN
        && symbol
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'/' || b == b'.')
}

/// Validate an orderbook depth parameter: must be between 1 and MAX_DEPTH.
pub fn validate_depth(depth: u16) -> bool {
    depth >= 1 && (depth as usize) <= MAX_DEPTH
}

/// Round a price to the nearest tick size.
/// Prevents floating-point drift from creating spurious price levels.
pub fn round_to_tick(price: f64) -> f64 {
    (price / TICK_SIZE).round() * TICK_SIZE
}

// ============================================
// Utility Helpers
//
// Pure computation functions shared between engines.
// ============================================

/// Compute orderbook imbalance: (bid_total - ask_total) / (bid_total + ask_total).
///
/// Returns 0.0 if both totals are zero (empty book).
/// Range: -1.0 (all asks) to +1.0 (all bids).
pub fn compute_imbalance(bid_total: f64, ask_total: f64) -> f64 {
    let sum = bid_total + ask_total;
    if sum < EPSILON {
        0.0
    } else {
        (bid_total - ask_total) / sum
    }
}

/// Compute mid price from best bid and best ask.
/// Returns None if either side is missing.
pub fn compute_mid_price(best_bid: Option<f64>, best_ask: Option<f64>) -> Option<f64> {
    match (best_bid, best_ask) {
        (Some(bid), Some(ask)) if validate_price(bid) && validate_price(ask) => {
            Some((bid + ask) / 2.0)
        }
        _ => None,
    }
}

/// Compute spread (ask - bid). Returns None if crossed or either side missing.
pub fn compute_spread(best_bid: Option<f64>, best_ask: Option<f64>) -> Option<f64> {
    match (best_bid, best_ask) {
        (Some(bid), Some(ask)) if ask >= bid => Some(ask - bid),
        _ => None,
    }
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_side_opposite() {
        assert_eq!(Side::Bid.opposite(), Side::Ask);
        assert_eq!(Side::Ask.opposite(), Side::Bid);
    }

    #[test]
    fn test_price_level_validation() {
        assert!(PriceLevel::new(100.0, 1.5).is_some());
        assert!(PriceLevel::new(0.0, 1.0).is_none()); // price must be > 0
        assert!(PriceLevel::new(-1.0, 1.0).is_none()); // negative price
        assert!(PriceLevel::new(100.0, -0.5).is_none()); // negative size
        assert!(PriceLevel::new(100.0, 0.0).is_some()); // zero size = removal
    }

    #[test]
    fn test_validate_symbol() {
        assert!(validate_symbol("BTC-USD"));
        assert!(validate_symbol("ETH/USDT"));
        assert!(validate_symbol("SOL_PERP"));
        assert!(!validate_symbol("")); // empty
        assert!(!validate_symbol(&"A".repeat(33))); // too long
        assert!(!validate_symbol("BTC USD")); // space not allowed
    }

    #[test]
    fn test_validate_depth() {
        assert!(validate_depth(1));
        assert!(validate_depth(20));
        assert!(validate_depth(MAX_DEPTH as u16));
        assert!(!validate_depth(0));
        assert!(!validate_depth(MAX_DEPTH as u16 + 1));
    }

    #[test]
    fn test_round_to_tick() {
        let rounded = round_to_tick(100.005);
        assert!((rounded - 100.01).abs() < EPSILON);

        let rounded = round_to_tick(100.004);
        assert!((rounded - 100.00).abs() < EPSILON);
    }

    #[test]
    fn test_imbalance() {
        assert!((compute_imbalance(100.0, 100.0) - 0.0).abs() < EPSILON);
        assert!((compute_imbalance(100.0, 0.0) - 1.0).abs() < EPSILON);
        assert!((compute_imbalance(0.0, 100.0) - (-1.0)).abs() < EPSILON);
        assert!((compute_imbalance(0.0, 0.0) - 0.0).abs() < EPSILON);
    }

    #[test]
    fn test_mid_price_and_spread() {
        assert_eq!(compute_mid_price(Some(100.0), Some(101.0)), Some(100.5));
        assert_eq!(compute_mid_price(None, Some(101.0)), None);
        assert_eq!(compute_spread(Some(100.0), Some(101.0)), Some(1.0));
        assert_eq!(compute_spread(Some(101.0), Some(100.0)), None); // crossed
    }
}
