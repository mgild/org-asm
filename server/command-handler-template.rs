//! # Command Handler Template
//!
//! Shows how the server receives and processes binary FlatBuffer commands
//! from browser clients. Commands flow upstream (client -> server) over the
//! same WebSocket that carries downstream FlatBuffer data frames.
//!
//! ## Architecture
//!
//! ```text
//! Browser                          Server
//! ───────                          ──────
//! CommandSender.send()
//!   → FlatBuffer bytes ──ws──→  handle_client_message()
//!                                  → parse CommandMessage
//!                                  → match on Command union
//!                                  → update engine / subscriptions
//! ```
//!
//! ## How to use
//!
//! 1. Copy this file into your server crate
//! 2. Generate Rust code from the commands schema:
//!      flatc --rust -o src/generated/ schema/commands.fbs
//! 3. Replace the generated import path with your actual module path
//! 4. Wire `handle_client_message()` into your WebSocket receive loop
//!    (see broadcast.rs — replace the `_ => {}` arm that ignores client messages)
//! 5. Customize the Subscribe/Unsubscribe handlers for your domain
//!
//! ## Integration with broadcast.rs
//!
//! In `handle_client` (broadcast.rs), replace the catch-all arm:
//!
//! ```rust
//! // Before:
//! _ => {} // Ignore client-to-server messages
//!
//! // After:
//! Some(Ok(Message::Binary(bytes))) => {
//!     let response = handle_client_message(&bytes, &mut subscriptions);
//!     // Optionally send response back to this client
//! }
//! ```

// Import generated FlatBuffer types from your commands schema.
// Replace this path with your actual generated module.
// use crate::generated::commands_generated::org_asm::commands::*;

use flatbuffers;
use tracing::{info, warn};

// ============================================
// Client message handler
// ============================================

/// Process a binary WebSocket message from a client.
///
/// Parses the bytes as a FlatBuffer CommandMessage and dispatches
/// to the appropriate handler based on the Command union type.
///
/// Returns an optional response (e.g., an ack or error) to send
/// back to the requesting client. In many cases, commands are
/// fire-and-forget and this returns None.
///
/// # Arguments
///
/// * `bytes` - Raw binary WebSocket message (FlatBuffer-encoded CommandMessage)
/// * `state` - Mutable reference to per-client or shared server state
///
/// # Example
///
/// ```rust
/// // In your WebSocket receive loop:
/// match msg {
///     Message::Binary(bytes) => {
///         if let Some(response) = handle_client_message(&bytes, &mut client_state) {
///             ws_tx.send(Message::Binary(response)).await.ok();
///         }
///     }
///     _ => {}
/// }
/// ```
pub fn handle_client_message(
    bytes: &[u8],
    state: &mut ClientState,
) -> Option<Vec<u8>> {
    // Parse the FlatBuffer root. flatbuffers::root() verifies the buffer
    // and returns a reference to the root table. Returns Err if the buffer
    // is malformed.
    //
    // Replace CommandMessage with your generated type:
    // let msg = match flatbuffers::root::<CommandMessage>(bytes) {
    //     Ok(msg) => msg,
    //     Err(e) => {
    //         warn!("Invalid command buffer: {e}");
    //         return None;
    //     }
    // };

    // let id = msg.id();
    //
    // // Match on the Command union type.
    // // FlatBuffers unions are represented as an enum + accessor method.
    // // command_type() returns the discriminant, command_as_*() returns the variant.
    // match msg.command_type() {
    //     Command::Subscribe => {
    //         let sub = msg.command_as_subscribe().unwrap();
    //         handle_subscribe(id, sub, state)
    //     }
    //     Command::Unsubscribe => {
    //         let unsub = msg.command_as_unsubscribe().unwrap();
    //         handle_unsubscribe(id, unsub, state)
    //     }
    //     Command::NONE => {
    //         warn!("Command {id}: empty command union");
    //         None
    //     }
    //     _ => {
    //         // Forward compatibility: unknown command types are silently ignored.
    //         // This lets older servers handle newer clients gracefully.
    //         warn!("Command {id}: unknown command type");
    //         None
    //     }
    // }

    // Placeholder until generated types are available:
    let _ = (bytes, state);
    warn!("Command handler not yet wired to generated FlatBuffer types");
    None
}

// ============================================
// Command handlers
//
// Each handler receives the parsed command and
// returns an optional response. Keep handlers
// focused on state mutation — no I/O here.
// ============================================

/// Handle a Subscribe command.
///
/// Adds the symbol to this client's subscription set and optionally
/// tells the engine to start processing data for that symbol.
///
/// # Design decisions
///
/// - Multiple clients can subscribe to the same symbol. The engine
///   tracks a reference count and only starts/stops processing when
///   the first subscriber arrives / last subscriber leaves.
///
/// - The depth parameter controls how many orderbook levels this
///   client wants. The server may broadcast more levels than requested;
///   the client filters to its desired depth locally.
///
/// - Returns None (fire-and-forget). If you want acknowledgements,
///   build a response FlatBuffer with the same id.
fn handle_subscribe(
    id: u64,
    symbol: &str,
    depth: u16,
    state: &mut ClientState,
) -> Option<Vec<u8>> {
    // Validate inputs using shared crate helpers
    // use my_shared::validate_identifier;
    //
    // if !validate_identifier(symbol, 32) {
    //     warn!("Command {id}: invalid symbol '{symbol}'");
    //     return None;
    // }
    // if depth == 0 || depth > 100 {
    //     warn!("Command {id}: invalid depth {depth}");
    //     return None;
    // }

    info!("Command {id}: subscribe symbol={symbol} depth={depth}");

    state.subscriptions.insert(symbol.to_string(), depth);

    // Tell the engine about the new subscription.
    // In a real implementation, this might:
    //   1. Add the symbol to the engine's active set
    //   2. Connect to the exchange feed for that symbol
    //   3. Send a snapshot of current state back to this client
    //
    // Example:
    // engine.lock().await.add_subscription(symbol, depth);

    None
}

/// Handle an Unsubscribe command.
///
/// Removes the symbol from this client's subscription set.
/// If no other clients are subscribed, the engine can stop
/// processing data for that symbol to save resources.
fn handle_unsubscribe(
    id: u64,
    symbol: &str,
    state: &mut ClientState,
) -> Option<Vec<u8>> {
    info!("Command {id}: unsubscribe symbol={symbol}");

    state.subscriptions.remove(symbol);

    // Tell the engine about the removed subscription.
    // engine.lock().await.remove_subscription(symbol);

    None
}

// ============================================
// Per-client state
//
// Each connected client has its own state tracking
// subscriptions, preferences, etc. This struct lives
// in the per-client WebSocket handler task.
// ============================================

/// Per-client state managed by the WebSocket handler.
///
/// Created when a client connects, dropped when they disconnect.
/// The broadcast handler (broadcast.rs) can embed this in the
/// `handle_client` function.
pub struct ClientState {
    /// Active subscriptions: symbol -> requested depth.
    /// When the client disconnects, all subscriptions are cleaned up.
    pub subscriptions: std::collections::HashMap<String, u16>,
}

impl ClientState {
    pub fn new() -> Self {
        Self {
            subscriptions: std::collections::HashMap::new(),
        }
    }
}

impl Default for ClientState {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================
// Integration example: modified handle_client
//
// This shows how to modify broadcast.rs to handle
// both downstream broadcasts and upstream commands.
// ============================================

// async fn handle_client(socket: WebSocket, broadcast: BroadcastState) {
//     let (mut ws_tx, mut ws_rx) = socket.split();
//     let mut rx = broadcast.subscribe();
//     let mut client_state = ClientState::new();
//
//     info!("Client connected");
//
//     loop {
//         tokio::select! {
//             // Forward broadcast frames to this client
//             result = rx.recv() => {
//                 match result {
//                     Ok(bytes) => {
//                         // Only send frames for symbols this client is subscribed to.
//                         // In practice, you'd check a symbol field in the frame header.
//                         if ws_tx.send(Message::Binary((*bytes).clone().into())).await.is_err() {
//                             break;
//                         }
//                     }
//                     Err(broadcast::error::RecvError::Lagged(n)) => {
//                         warn!("Client lagged, skipped {n} frames");
//                     }
//                     Err(broadcast::error::RecvError::Closed) => break,
//                 }
//             }
//             // Handle client commands (binary) and control messages
//             msg = ws_rx.next() => {
//                 match msg {
//                     Some(Ok(Message::Binary(bytes))) => {
//                         // Client sent a command — parse and handle it
//                         if let Some(response) = handle_client_message(&bytes, &mut client_state) {
//                             if ws_tx.send(Message::Binary(response.into())).await.is_err() {
//                                 break;
//                             }
//                         }
//                     }
//                     Some(Ok(Message::Close(_))) | None => break,
//                     Some(Err(_)) => break,
//                     _ => {}
//                 }
//             }
//         }
//     }
//
//     // Cleanup: remove all subscriptions for this client
//     for symbol in client_state.subscriptions.keys() {
//         info!("Cleaning up subscription: {symbol}");
//         // engine.lock().await.remove_subscription(symbol);
//     }
//
//     info!("Client disconnected");
// }
