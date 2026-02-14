# Server Engine Pattern

How to build a server-side Rust engine that ingests exchange data and broadcasts FlatBuffer frames to browser clients over binary WebSocket.

## Architecture

```
Exchange WS ──→ Server Engine (Rust/Axum)  ──→  Client Engine (WASM + React)
                 │                                │
                 │ ServerEngine trait              │ ingest_frame(&[u8])
                 │ ingest() on each msg           │ tick() at 60fps
                 │ tick() at 20-100Hz             │ AnimationLoop → DOM
                 │ FlatBuffer serialize            │
                 │ broadcast::channel fan-out      │
                 └─────────────────────────────────┘
                   shared .fbs schema (flatc --rust + --ts)
```

The pipeline has two engines sharing a FlatBuffers schema:

1. **Server engine** (native Rust) — ingests exchange data, maintains state, serializes to FlatBuffer bytes, broadcasts over WebSocket
2. **Client engine** (WASM) — receives FlatBuffer bytes, deserializes, feeds the 60fps animation loop

## The ServerEngine Trait

```rust
pub trait ServerEngine: Send + 'static {
    /// Process raw exchange message. Returns true if state changed.
    fn ingest(&mut self, msg: &[u8]) -> bool;

    /// Serialize current state to FlatBuffer bytes.
    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8];

    /// Optional: snapshot for late-joining clients.
    fn snapshot(&self, _builder: &mut FlatBufferBuilder<'static>) -> Option<Vec<u8>> { None }
}
```

Key design choices:
- `FlatBufferBuilder` is passed in and reused — no allocation per tick
- `tick()` returns a borrowed slice — bytes are copied once into the broadcast channel
- `Send + 'static` bound allows the engine to be wrapped in `Arc<Mutex<>>` for shared access

## Broadcast Pattern

The broadcast layer uses `tokio::sync::broadcast` with `Arc<Vec<u8>>`:

- Server serializes once per tick
- All clients receive the same `Arc<Vec<u8>>` — zero copy per client
- Slow clients that fall behind get a `Lagged` error and skip to the latest frame
- Channel capacity determines how many frames buffer before lagging (1024 = ~20s at 50Hz)

## Setting Up the Server

### 1. Copy templates

```bash
mkdir -p my-server/src
cp node_modules/org-asm/server/engine-trait.rs my-server/src/engine_trait.rs
cp node_modules/org-asm/server/broadcast.rs my-server/src/broadcast.rs
cp node_modules/org-asm/server/main-template.rs my-server/src/main.rs
cp node_modules/org-asm/server/Cargo.template.toml my-server/Cargo.toml
```

### 2. Implement your engine

```rust
use flatbuffers::FlatBufferBuilder;
use crate::engine_trait::ServerEngine;
use crate::generated::orderbook_generated::*;

pub struct OrderbookEngine {
    bids: Vec<(f64, f64)>,
    asks: Vec<(f64, f64)>,
    sequence: u64,
}

impl ServerEngine for OrderbookEngine {
    fn ingest(&mut self, msg: &[u8]) -> bool {
        // Parse your exchange format
        let text = std::str::from_utf8(msg).unwrap();
        let update: serde_json::Value = serde_json::from_str(text).unwrap();
        // Update bids/asks...
        self.sequence += 1;
        true
    }

    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8] {
        builder.reset();
        // Build FlatBuffer from current state
        // ... create vectors, build table ...
        builder.finished_data()
    }
}
```

### 3. Generate FlatBuffer code

```bash
flatc --rust -o my-server/src/generated/ schema/orderbook.fbs
flatc --ts  -o src/generated/             schema/orderbook.fbs
```

### 4. Run

```bash
cd my-server && cargo run --release
```

## Client Integration

### Binary WebSocket + BinaryFrameParser

```ts
import { WebSocketPipeline, BinaryFrameParser } from 'org-asm';

const engine = new Engine();  // Your WASM engine with ingest_frame()

// BinaryFrameParser passes ArrayBuffer bytes to engine.ingest_frame()
const parser = new BinaryFrameParser(engine)
  .onFrame(() => {
    // Post-ingest side effects (e.g., emit to React store)
    store.getState().update(engine.best_bid, engine.best_ask);
  });

// WebSocket with binaryType: 'arraybuffer'
const ws = new WebSocketPipeline({
  url: 'ws://localhost:9001/ws',
  binaryType: 'arraybuffer',
});
ws.onBinaryMessage((data) => parser.ingestFrame(data));
ws.connect();
```

### Client WASM engine

```rust
#[wasm_bindgen]
pub fn ingest_frame(&mut self, bytes: &[u8]) {
    let frame = flatbuffers::root::<OrderbookFrame>(bytes).unwrap();
    self.best_bid = frame.best_bid();
    self.best_ask = frame.best_ask();
    self.mid_price = frame.mid_price();
    self.spread = frame.spread();
    // ... update state from FlatBuffer fields ...
    self.data_version += 1;
}
```

The client engine's `tick()` then reads from these fields as usual, driving the animation loop.

## Tick Rate Tuning

| Rate | Interval | Use Case |
|------|----------|----------|
| 20 Hz | 50ms | Low-frequency data, position updates |
| 50 Hz | 20ms | Orderbook streaming (recommended default) |
| 100 Hz | 10ms | Ultra-low-latency trading UIs |

The server tick rate is independent of the client's 60fps render loop. The client interpolates between received frames.

## FlatBuffers Schema Design

Key rules for high-frequency schemas:

- Use `struct` (not `table`) for fixed-size data like price levels — zero vtable overhead, inline access
- Precompute derived values server-side (spread, imbalance, mid_price) to avoid client computation
- Include `sequence` and `timestamp_ms` for ordering and latency measurement
- Keep the schema flat — avoid deep nesting for serialization speed

## Orderbook Example Schema

```fbs
struct PriceLevel {
  price: double;
  size: double;
}

table OrderbookFrame {
  best_bid: double;
  best_ask: double;
  mid_price: double;
  spread: double;
  bids: [PriceLevel];
  asks: [PriceLevel];
  timestamp_ms: uint64;
  sequence: uint64;
  bid_total_size: double;
  ask_total_size: double;
  imbalance: double;
}
```

`PriceLevel` as a `struct` means each level is exactly 16 bytes inline — no pointer indirection, cache-friendly sequential access.
