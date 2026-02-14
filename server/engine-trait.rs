//! # ServerEngine Trait
//!
//! The server-side counterpart to the WASM client engine. Where the client engine
//! runs in the browser at 60fps rendering frames, the server engine runs on native
//! Rust ingesting exchange data and broadcasting FlatBuffer frames to all connected
//! clients over binary WebSocket.
//!
//! ## Architecture
//!
//! ```text
//! Exchange WS ──→ engine.ingest(&[u8])  (on each message)
//!                      │
//!                 engine.tick(&mut builder)  (at 20-100Hz)
//!                      │
//!                 broadcast::send(bytes)  (fan-out to all clients)
//!                      │
//!              Client WASM engine.ingest_frame(&[u8])
//! ```
//!
//! ## How to Implement
//!
//! 1. Define your state struct (orderbook, positions, etc.)
//! 2. Implement `ingest()` to parse exchange messages and update state
//! 3. Implement `tick()` to serialize state to FlatBuffer bytes
//! 4. Optionally implement `snapshot()` for late-joining clients
//!
//! ## Example: Orderbook Engine
//!
//! ```rust
//! use flatbuffers::FlatBufferBuilder;
//!
//! pub struct OrderbookEngine {
//!     bids: Vec<(f64, f64)>,  // (price, size)
//!     asks: Vec<(f64, f64)>,
//!     sequence: u64,
//!     dirty: bool,
//! }
//!
//! impl ServerEngine for OrderbookEngine {
//!     fn ingest(&mut self, msg: &[u8]) -> bool {
//!         // Parse exchange-specific message format (JSON, binary, etc.)
//!         // Update bids/asks
//!         // Return true if state changed
//!         self.dirty = true;
//!         true
//!     }
//!
//!     fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8] {
//!         builder.reset();
//!         // Serialize orderbook to FlatBuffer using schema/orderbook.fbs
//!         // ... build bids/asks vectors, create OrderbookFrame ...
//!         // builder.finished_data()
//!         self.dirty = false;
//!         builder.finished_data()
//!     }
//! }
//! ```

use flatbuffers::FlatBufferBuilder;

/// Server-side engine trait for native Rust data processing.
///
/// Implementors own domain state (orderbook, positions, etc.) and serialize
/// it to FlatBuffer bytes on each tick. The broadcast layer fans out the
/// serialized bytes to all connected WebSocket clients.
///
/// The `FlatBufferBuilder` is passed into `tick()` and reused across calls
/// to avoid repeated allocation. Call `builder.reset()` at the start of
/// each tick.
pub trait ServerEngine: Send + 'static {
    /// Process a raw exchange message. Returns true if state changed.
    ///
    /// Called on every incoming WebSocket message from the exchange.
    /// Parse the message format (JSON, binary, protobuf, etc.) and
    /// update internal state. The return value lets the tick loop
    /// skip serialization when nothing changed.
    fn ingest(&mut self, msg: &[u8]) -> bool;

    /// Serialize current state to FlatBuffer bytes.
    ///
    /// Called at the configured tick rate (20-100Hz). The builder is
    /// passed in and should be `reset()` at the start. Returns the
    /// finished FlatBuffer bytes that will be broadcast to all clients.
    ///
    /// The returned slice borrows from the builder and is valid until
    /// the next `tick()` call.
    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8];

    /// Optional: produce a full state snapshot for late-joining clients.
    ///
    /// When a new client connects, they receive this snapshot before
    /// joining the live broadcast stream. This ensures they start with
    /// a complete view of the current state.
    ///
    /// Default implementation returns None (no snapshot support).
    fn snapshot(&self, _builder: &mut FlatBufferBuilder<'static>) -> Option<Vec<u8>> {
        None
    }
}
