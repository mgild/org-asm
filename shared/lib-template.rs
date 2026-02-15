//! # Shared Crate Template
//!
//! Common types, constants, and validation shared between the server engine (native Rust)
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
//! - Domain types shared between server and client
//! - Validation functions (input sanitization, range checks)
//! - Constants both sides must agree on
//! - Pure computation helpers (no I/O, no WASM bindings)
//!
//! ## What does NOT belong here
//!
//! - `#[wasm_bindgen]` attributes (those go in the client engine crate)
//! - Server-only logic (WebSocket handling, broadcast, etc.)
//! - FlatBuffer generated code (generated per-target from schema/*.fbs)
//! - I/O, networking, or platform-specific code
//!
//! ## How to use
//!
//! Replace the example types below with your own domain types.
//! Import from both crates:
//!
//! ```toml
//! # In server/Cargo.toml and engine/Cargo.toml:
//! [dependencies]
//! my-shared = { path = "../shared" }
//! ```

// ============================================
// Constants
//
// Shared between server and client so both sides
// agree on limits and precision. Change these in
// one place and both targets pick them up.
// ============================================

/// Exponential smoothing factor for animation.
/// Both server (tick serialization) and client (rendering)
/// should agree on this for consistent behavior.
pub const SMOOTHING_FACTOR: f64 = 0.08;

/// How many seconds of time-series data to retain.
pub const HISTORY_WINDOW_SEC: f64 = 30.0;

/// Tolerance for floating-point comparisons.
pub const EPSILON: f64 = 1e-10;

// ============================================
// Domain Types
//
// Replace these with your own domain types.
// Keep them simple: no side effects, no platform-specific
// derives. serde is optional (for JSON in tests or REST).
// ============================================

// Example: add your domain types here.
//
// pub enum Side { Bid, Ask }
//
// pub struct PriceLevel { pub price: f64, pub size: f64 }
//
// The point is: types that both server and client need
// live here, so they can't drift out of sync.

// ============================================
// Validation Helpers
//
// Used by both server (validating exchange data)
// and client (validating user commands). Keeping
// validation in the shared crate ensures both sides
// reject the same invalid inputs.
// ============================================

/// Validate a positive finite number (prices, sizes, etc.)
pub fn validate_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

/// Validate a non-negative finite number.
pub fn validate_non_negative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

/// Validate a string identifier: non-empty, within length limit,
/// ASCII alphanumeric with common separators.
pub fn validate_identifier(s: &str, max_len: usize) -> bool {
    !s.is_empty()
        && s.len() <= max_len
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'/' || b == b'.')
}

// ============================================
// Computation Helpers
//
// Pure functions used by both engines.
// ============================================

/// Clamp and normalize a value to 0.0..1.0 given a range.
pub fn normalize(value: f64, min: f64, max: f64) -> f64 {
    if (max - min).abs() < EPSILON {
        0.0
    } else {
        ((value - min) / (max - min)).clamp(0.0, 1.0)
    }
}

/// Linear interpolation between two values.
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_positive() {
        assert!(validate_positive(1.0));
        assert!(validate_positive(0.001));
        assert!(!validate_positive(0.0));
        assert!(!validate_positive(-1.0));
        assert!(!validate_positive(f64::NAN));
        assert!(!validate_positive(f64::INFINITY));
    }

    #[test]
    fn test_validate_identifier() {
        assert!(validate_identifier("my-app", 32));
        assert!(validate_identifier("data/stream_1", 32));
        assert!(!validate_identifier("", 32));
        assert!(!validate_identifier(&"a".repeat(33), 32));
        assert!(!validate_identifier("has spaces", 32));
    }

    #[test]
    fn test_normalize() {
        assert!((normalize(50.0, 0.0, 100.0) - 0.5).abs() < EPSILON);
        assert!((normalize(0.0, 0.0, 100.0) - 0.0).abs() < EPSILON);
        assert!((normalize(150.0, 0.0, 100.0) - 1.0).abs() < EPSILON); // clamped
    }

    #[test]
    fn test_lerp() {
        assert!((lerp(0.0, 100.0, 0.5) - 50.0).abs() < EPSILON);
        assert!((lerp(0.0, 100.0, 0.0) - 0.0).abs() < EPSILON);
        assert!((lerp(0.0, 100.0, 1.0) - 100.0).abs() < EPSILON);
    }
}
