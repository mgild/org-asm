//! # Server Main Template
//!
//! Wiring template showing how to run a server engine with three concurrent tasks:
//!
//! 1. **Exchange ingest**: connects to exchange WS, feeds messages to engine
//! 2. **Tick loop**: runs engine.tick() at a fixed rate, broadcasts FlatBuffer frames
//! 3. **Axum server**: serves /ws endpoint for browser clients
//!
//! ## How to use
//!
//! 1. Copy this file into your server crate
//! 2. Implement `ServerEngine` for your domain (see engine-trait.rs)
//! 3. Replace `YourEngine::new()` with your engine constructor
//! 4. Replace the exchange WebSocket URL with your data source
//! 5. Customize the tick rate and exchange message parsing
//!
//! ## Architecture
//!
//! ```text
//! Exchange WS ──→ engine.ingest()    (Task 1: ingest)
//!                      │
//!                 engine.tick()       (Task 2: tick loop at 50Hz)
//!                      │
//!                 broadcast.send()   (fan-out)
//!                      │
//!              Axum /ws endpoint     (Task 3: per-client forward)
//!                      │
//!              Browser WASM engine
//! ```

use std::sync::Arc;
use std::time::Duration;

use axum::{extract::ws::Message, routing::get, Router};
use flatbuffers::FlatBufferBuilder;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tracing::{error, info};
use tracing_subscriber;

// Import your engine and broadcast module
mod broadcast;
mod engine_trait;
// mod your_engine;  // Your ServerEngine implementation

use broadcast::{ws_handler, BroadcastState};
use engine_trait::ServerEngine;

// ============================================
// Configuration
// ============================================

/// Exchange WebSocket URL — replace with your data source
const EXCHANGE_WS_URL: &str = "wss://stream.example.com/ws";

/// Server tick rate in milliseconds.
/// 20ms = 50Hz — good balance for orderbook data.
/// Lower = more responsive but more bandwidth.
/// Higher = less bandwidth but more latency.
const TICK_INTERVAL_MS: u64 = 20;

/// Address to bind the WebSocket server
const BIND_ADDR: &str = "0.0.0.0:9001";

/// Broadcast channel capacity (frames buffered for slow clients)
const BROADCAST_CAPACITY: usize = 1024;

// ============================================
// Main
// ============================================

#[tokio::main]
async fn main() {
    tracing_subscriber::init();

    // --- Shared state ---
    // Engine wrapped in Arc<Mutex<>> for shared access between ingest and tick tasks.
    // This is simple and correct. For ultra-low-latency, replace with:
    //   - Separate ingest/tick engines connected by a channel
    //   - Lock-free ring buffer for message passing
    //   - Dedicated threads with core pinning
    let engine = Arc::new(Mutex::new(YourEngine::new()));
    let broadcast = BroadcastState::new(BROADCAST_CAPACITY);
    let broadcast_for_tick = broadcast.clone();

    // --- Task 1: Exchange ingest ---
    // Connects to the exchange WebSocket and feeds raw messages to the engine.
    let engine_for_ingest = engine.clone();
    let ingest_handle = tokio::spawn(async move {
        loop {
            match connect_async(EXCHANGE_WS_URL).await {
                Ok((ws_stream, _)) => {
                    info!("Connected to exchange");
                    let (_, mut read) = ws_stream.split();

                    while let Some(msg) = read.next().await {
                        match msg {
                            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                                let mut eng = engine_for_ingest.lock().await;
                                eng.ingest(text.as_bytes());
                            }
                            Ok(tokio_tungstenite::tungstenite::Message::Binary(bin)) => {
                                let mut eng = engine_for_ingest.lock().await;
                                eng.ingest(&bin);
                            }
                            Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => {
                                info!("Exchange connection closed");
                                break;
                            }
                            Err(e) => {
                                error!("Exchange WS error: {e}");
                                break;
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to connect to exchange: {e}");
                }
            }

            // Reconnect after delay
            info!("Reconnecting to exchange in 3s...");
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });

    // --- Task 2: Tick loop ---
    // Runs the engine at a fixed rate and broadcasts serialized frames.
    let engine_for_tick = engine.clone();
    let tick_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(TICK_INTERVAL_MS));
        let mut builder = FlatBufferBuilder::with_capacity(4096);

        loop {
            interval.tick().await;

            let bytes = {
                let mut eng = engine_for_tick.lock().await;
                let data = eng.tick(&mut builder);
                data.to_vec() // Copy out of builder before releasing lock
            };

            broadcast_for_tick.send(bytes);
        }
    });

    // --- Task 3: Axum WebSocket server ---
    // Serves the /ws endpoint. Each client gets its own forward task.
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(broadcast);

    let listener = TcpListener::bind(BIND_ADDR).await.unwrap();
    info!("Server listening on {BIND_ADDR}");

    axum::serve(listener, app).await.unwrap();
}

// ============================================
// Replace this with your engine implementation
// ============================================

struct YourEngine {
    // Your state here
}

impl YourEngine {
    fn new() -> Self {
        Self {}
    }
}

impl ServerEngine for YourEngine {
    fn ingest(&mut self, _msg: &[u8]) -> bool {
        // Parse exchange message, update state
        // Return true if state changed
        true
    }

    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8] {
        builder.reset();
        // Serialize state to FlatBuffer
        // Example with orderbook.fbs:
        //   let bids = builder.create_vector(&self.bids);
        //   let asks = builder.create_vector(&self.asks);
        //   let frame = OrderbookFrame::create(&mut builder, &OrderbookFrameArgs {
        //       best_bid: self.best_bid,
        //       best_ask: self.best_ask,
        //       mid_price: (self.best_bid + self.best_ask) / 2.0,
        //       spread: self.best_ask - self.best_bid,
        //       bids: Some(bids),
        //       asks: Some(asks),
        //       timestamp_ms: self.timestamp,
        //       sequence: self.sequence,
        //       bid_total_size: self.bid_total,
        //       ask_total_size: self.ask_total,
        //       imbalance: self.imbalance,
        //   });
        //   builder.finish(frame, None);
        builder.finished_data()
    }
}
