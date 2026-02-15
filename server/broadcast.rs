//! # WebSocket Broadcast Handler
//!
//! Axum WebSocket handler that fans out binary FlatBuffer frames to all
//! connected clients. Uses `tokio::sync::broadcast` for efficient one-to-many
//! distribution: the server serializes once, all clients read the same `Arc<Vec<u8>>`.
//!
//! ## Architecture
//!
//! ```text
//! Tick loop ──→ broadcast::send(Arc<Vec<u8>>)
//!                    │
//!              ┌─────┼─────┐
//!              ▼     ▼     ▼
//!          client1 client2 client3   (each has a broadcast::Receiver)
//! ```
//!
//! ## Usage
//!
//! ```rust
//! let state = BroadcastState::new(1024);  // buffer 1024 frames
//!
//! // In tick loop:
//! state.send(bytes);
//!
//! // In Axum router:
//! let app = Router::new()
//!     .route("/ws", get(ws_handler))
//!     .with_state(state);
//! ```

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tracing::{info, warn};

/// Shared broadcast state. Clone this into Axum routes.
///
/// Wraps a `broadcast::Sender` that distributes `Arc<Vec<u8>>` frames.
/// Arc ensures the serialized bytes are shared (not copied) across all
/// client tasks.
#[derive(Clone)]
pub struct BroadcastState {
    tx: broadcast::Sender<Arc<Vec<u8>>>,
}

impl BroadcastState {
    /// Create a new broadcast state with the given channel capacity.
    ///
    /// Capacity determines how many frames can be buffered before slow
    /// clients start dropping frames (lagged). For a 50Hz tick rate,
    /// 1024 buffers ~20 seconds of data.
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }

    /// Send a frame to all connected clients.
    ///
    /// Wraps the bytes in Arc so all receivers share the same allocation.
    /// Returns the number of receivers that will receive the message.
    pub fn send(&self, bytes: Vec<u8>) -> usize {
        // Ignore error when no receivers are connected
        self.tx.send(Arc::new(bytes)).unwrap_or(0)
    }

    /// Subscribe to the broadcast channel.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Vec<u8>>> {
        self.tx.subscribe()
    }
}

/// Axum handler that upgrades HTTP to WebSocket.
///
/// Mount on your router:
/// ```rust
/// Router::new().route("/ws", get(ws_handler)).with_state(state)
/// ```
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BroadcastState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_client(socket, state))
}

/// Per-client WebSocket forward loop.
///
/// Subscribes to the broadcast channel and forwards every frame as a
/// binary WebSocket message. Handles client disconnect gracefully.
///
/// If the client falls behind (broadcast channel lags), we skip ahead
/// to the latest frame rather than disconnecting.
///
/// ## Snapshot-on-connect (gap-free startup)
///
/// To ensure clients receive complete state on connect without missing
/// frames, subscribe to broadcast FIRST, then send a snapshot, then enter
/// the forward loop. Because the subscription is created before the
/// snapshot is sent, any frames produced during snapshot serialization
/// are buffered in the broadcast channel and forwarded after the snapshot.
///
/// ```rust
/// // 1. Subscribe BEFORE snapshot — no frames can be missed
/// let mut rx = state.subscribe();
///
/// // 2. Send snapshot (full current state)
/// // if let Some(snapshot) = engine.lock().await.snapshot(&mut builder) {
/// //     ws_tx.send(Message::Binary(snapshot.into())).await.ok();
/// // }
///
/// // 3. Enter forward loop — buffered frames delivered in order
/// ```
async fn handle_client(socket: WebSocket, state: BroadcastState) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut rx = state.subscribe();

    info!("Client connected");

    // --- Snapshot-on-connect template ---
    // Uncomment to send full state snapshot before forwarding live frames.
    // The broadcast subscription is already active, so no gap is possible.
    //
    // if let Some(snapshot) = engine.lock().await.snapshot(&mut builder) {
    //     if ws_tx.send(Message::Binary(snapshot.into())).await.is_err() {
    //         info!("Client disconnected during snapshot");
    //         return;
    //     }
    // }

    loop {
        tokio::select! {
            // Forward broadcast frames to this client
            result = rx.recv() => {
                match result {
                    Ok(bytes) => {
                        if ws_tx.send(Message::Binary((*bytes).clone().into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("Client lagged, skipped {n} frames");
                        // Continue — next recv() gets the latest frame
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break; // Server shutting down
                    }
                }
            }
            // Handle client messages (close, ping, etc.)
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {} // Ignore client-to-server messages
                }
            }
        }
    }

    info!("Client disconnected");
}
