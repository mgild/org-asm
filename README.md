# orgASM

**Organized Assembly for Structured Motion.**

A Rust-first MVC framework for building 60fps React applications where computation lives in WebAssembly and TypeScript is reduced to a thin rendering layer.

---

## Problem

Real-time web apps — data visualization, simulations, live dashboards, trading interfaces — face a structural tension: computation runs at 60fps but React re-renders are expensive. The typical result is a tangle of `useRef`, `requestAnimationFrame`, manual DOM mutations, and ad-hoc throttling scattered across components. No separation of concerns. No testability. No reuse.

## Solution

orgASM provides a complete MVC architecture for real-time WASM+React applications:

- **Model** (Rust/WASM): Owns all state and computation. `tick()` serializes state into a FlatBuffer frame — JS reads it zero-copy from WASM linear memory. One WASM call per frame instead of N getter calls.
- **View** (TypeScript + React hooks): Applies frame data to DOM, canvas, and charts. Priority-ordered consumers handle data sync, visual effects, and React state updates at different rates.
- **Controller** (TypeScript): Routes external data (WebSocket) and user input to the Model. Handles connection lifecycle, message parsing, and bidirectional commands.
- **Server** (Rust/Axum): Optional upstream engine that ingests exchange data and broadcasts FlatBuffer frames to all clients over binary WebSocket.

At 60fps with 39 frame fields, the FlatBuffer protocol makes **60 boundary crossings/sec instead of 2,340**.

## Architecture

```
┌──────────────────────────────────────┐
│   SERVER ENGINE (Rust/Axum)          │
│   Optional upstream data processor   │
│   ServerEngine trait → ingest/tick   │
│   FlatBuffer serialize → broadcast   │
│   CommandHandler ← client commands   │
└──────────────────┬───────────────────┘
                   │ Binary WebSocket (FlatBuffer bytes)
┌──────────────────▼───────────────────┐
│          MODEL (Rust WASM)           │
│  Engine struct owns ALL state        │
│  tick(now_ms) → FlatBuffer frame     │
│  ingest_frame(&[u8]) ← server bytes │
│  Shared crate for domain types       │
└──────────────────┬───────────────────┘
                   │ Frame (FlatBuffer)
┌──────────────────▼───────────────────┐
│          VIEW (TypeScript + React)   │
│  AnimationLoop    → orchestrates     │
│  EffectApplicator → DOM/CSS writes   │
│  ChartDataConsumer → chart library   │
│  useFrame()       → React hook       │
│  useConnection()  → WS state hook    │
└──────────────────┬───────────────────┘
                   │ user events / commands
┌──────────────────▼───────────────────┐
│       CONTROLLER (TypeScript)        │
│  WebSocketPipeline → data ingestion  │
│  BinaryFrameParser → binary frames   │
│  CommandSender     → typed commands  │
│  InputController   → user actions    │
│  WasmBridge        → WASM lifecycle  │
└──────────────────────────────────────┘
```

### Three-Speed Data Flow

```
60fps:  Engine.tick() → Canvas/DOM         (module-level, zero React)
~10fps: useFrame() / ThrottledStateSync    (React re-renders)
~1fps:  Config changes → Engine.set_*()    (user interaction)
```

These speeds never mix. 60fps data flows through the frame buffer and direct DOM writes. React only sees throttled snapshots at ~10fps. Configuration changes are infrequent method calls.

## Install

```bash
npm install org-asm
```

Peer dependencies: `react` (>=18), `zustand` (>=4), `rxjs` (>=7). All optional.

## Quick Start

### 0. Scaffold a Project (Recommended)

```bash
npx org-asm init my-app
cd my-app
npm install
npx org-asm build
```

This generates a complete full-stack project with WASM engine, server engine, shared crate, React app, and build scripts. Skip to step 3 to start customizing.

### 1. Define Your Frame Schema

Define a `.fbs` schema — the single source of truth for both Rust and TypeScript:

```fbs
// schema/frame.fbs
namespace MyApp;

table Frame {
  intensity: double = 0.0;
  is_active: bool = false;
  color_r: ubyte = 0;
  color_g: ubyte = 0;
  color_b: ubyte = 0;
}

root_type Frame;
```

Generate code for both sides:

```bash
flatc --rust -o crates/my-engine/src/generated/ schema/frame.fbs
flatc --ts  -o src/generated/ schema/frame.fbs
```

### 2. Create Your Rust Engine

Copy the template and customize:

```bash
cp node_modules/org-asm/model/engine-template.rs crates/my-engine/src/engine.rs
cp node_modules/org-asm/model/Cargo.template.toml crates/my-engine/Cargo.toml
```

Implement `tick()` using the generated FlatBuffer types:

```rust
use flatbuffers::FlatBufferBuilder;
use crate::generated::frame_generated::*;

#[wasm_bindgen]
impl Engine {
    pub fn tick(&mut self, now_ms: f64) {
        self.builder.reset();
        self.smooth_value += (self.current_value - self.smooth_value) * 0.08;
        let color = compute_color(self.smooth_value);

        let frame = Frame::create(&mut self.builder, &FrameArgs {
            intensity: self.smooth_value,
            is_active: self.active,
            color_r: color.0,
            color_g: color.1,
            color_b: color.2,
        });
        self.builder.finish(frame, None);
    }

    // JS reads FlatBuffer bytes zero-copy from WASM memory
    pub fn frame_ptr(&self) -> *const u8 {
        self.builder.finished_data().as_ptr()
    }

    pub fn frame_len(&self) -> usize {
        self.builder.finished_data().len()
    }
}
```

Build:
```bash
wasm-pack build crates/my-engine --target web --release
```

### 3. Wire with React Hooks

```tsx
import { useWasm, useAnimationLoop, useFrame, useConnection } from 'org-asm/react';
import init, { Engine } from './pkg/my_engine';
import { Frame } from './generated/frame';
import { ByteBuffer } from 'flatbuffers';

function App() {
  const { memory, ready } = useWasm(() => init());
  const engine = useMemo(() => ready ? new Engine() : null, [ready]);

  const loop = useAnimationLoop(engine, memory,
    bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));

  // React re-renders at 10fps with the latest intensity
  const intensity = useFrame(loop, f => f.intensity(), 100);

  // Connection state with error + staleness tracking
  const { pipeline, connected, state, error, stale } = useConnection({
    url: 'wss://your-source/ws',
    binaryType: 'arraybuffer',
  });

  // Wire data source to engine
  useEffect(() => {
    if (!engine) return;
    pipeline.onBinaryMessage(data => engine.ingest_frame(new Uint8Array(data)));
  }, [pipeline, engine]);

  return (
    <div>
      <div style={{ opacity: intensity ?? 0 }}>Value: {intensity?.toFixed(2)}</div>
      <span>{connected ? (stale ? 'Stale' : 'Live') : `Reconnecting... (${state})`}</span>
      {error && <span style={{ color: 'red' }}>{error.message}</span>}
    </div>
  );
}
```

5 lines to go from nothing to connected + rendering at 60fps.

### 4. Connect a Data Source

Message parsing belongs in Rust. The engine implements `ingest_message()` with serde_json — one boundary crossing replaces many, and zero JS objects are allocated.

```rust
// In your Rust engine:
#[wasm_bindgen]
pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 {
    #[derive(Deserialize)]
    struct Msg { value: f64, timestamp: f64 }

    let msg: Msg = match serde_json::from_str(raw) {
        Ok(m) => m,
        Err(_) => return 0,
    };
    self.add_data_point(msg.value, msg.timestamp, now_ms);
    1 // INGEST_DATA_UPDATED
}
```

```ts
import { WebSocketPipeline, WasmIngestParser } from 'org-asm';

const parser = new WasmIngestParser(engine);
const ws = new WebSocketPipeline({ url: 'wss://your-source/ws' });
ws.onMessage((raw) => parser.parse(raw, engine, Date.now()));
ws.connect();
```

### 5. Server Engine (Optional)

For high-frequency data like orderbooks, run a server engine in native Rust that ingests exchange data and broadcasts FlatBuffer frames to all browser clients:

```bash
npx org-asm init my-app   # includes server crate
# or copy templates manually:
cp node_modules/org-asm/server/engine-trait.rs my-server/src/engine_trait.rs
cp node_modules/org-asm/server/broadcast.rs my-server/src/broadcast.rs
cp node_modules/org-asm/server/main-template.rs my-server/src/main.rs
cp node_modules/org-asm/server/Cargo.template.toml my-server/Cargo.toml
```

Implement the `ServerEngine` trait:

```rust
impl ServerEngine for OrderbookEngine {
    fn ingest(&mut self, msg: &[u8]) -> bool {
        // Parse exchange message, update orderbook state
        true
    }

    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8] {
        builder.reset();
        // Serialize orderbook to FlatBuffer bytes
        builder.finished_data()
    }
}
```

### 6. Send Commands to the Server

Generate a typed `CommandBuilder` subclass from your `.fbs` schema:

```bash
npx org-asm gen-builder schema/commands.fbs -o src/generated/
```

This produces a `CommandsBuilder` with nested table objects — no manual boilerplate:

```ts
import { CommandSender } from 'org-asm/controller';
import { CommandsBuilder } from './generated/CommandsBuilder';
import { Command } from './generated/org-asm/commands/command';

class MyCommands extends CommandSender<CommandsBuilder> {
  constructor(pipeline: WebSocketPipeline) { super(pipeline, new CommandsBuilder()); }

  subscribe(symbol: string, depth = 20): bigint {
    return this.send(b => {
      const sym = b.createString(symbol);
      const sub = b.subscribe.start().addSymbol(sym).addDepth(depth).end();
      return b.commandMessage.start()
        .addId(b.id)
        .addCommandType(Command.Subscribe)
        .addCommand(sub)
        .end();
    });
  }
}

const commands = new MyCommands(pipeline);
commands.subscribe('BTC-USD', 20);
```

### 7. Shared Rust Crate

Keep domain types, validation, and constants in a shared crate used by both server and WASM engines:

```bash
cp node_modules/org-asm/shared/lib-template.rs crates/shared/src/lib.rs
cp node_modules/org-asm/shared/Cargo.template.toml crates/shared/Cargo.toml
```

```rust
// crates/shared/src/lib.rs — add your domain types here
pub const SMOOTHING_FACTOR: f64 = 0.08;
pub const HISTORY_WINDOW_SEC: f64 = 30.0;

pub fn validate_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

pub fn normalize(value: f64, min: f64, max: f64) -> f64 {
    ((value - min) / (max - min)).clamp(0.0, 1.0)
}
```

Both server and WASM crates import this:
```toml
[dependencies]
my-shared = { path = "../shared" }
```

### 8. Build Everything

```bash
npx org-asm build
```

Runs the full pipeline: `flatc` codegen (Rust + TS) → `wasm-pack build` → `cargo build --release` (server).

## API Reference

### React Hooks (`org-asm/react`)

| Hook | Returns | Description |
|------|---------|-------------|
| `useWasm(initFn)` | `{ memory, ready, error }` | Initialize WASM module, track loading state |
| `useAnimationLoop(engine, memory, rootFn)` | `AnimationLoop \| null` | Create 60fps loop with FlatBuffer adapter |
| `useFrame(loop, extract, throttleMs?)` | `T \| null` | Throttled frame value subscription (default 100ms) |
| `useConnection(config)` | `{ pipeline, connected, state, error, stale }` | WebSocket/SSE with full connection state, error, and staleness tracking |
| `useWorker(config)` | `{ loop, bridge, ready, error }` | Off-main-thread WASM via Worker + SharedArrayBuffer |

### Core

#### `flatBufferTickAdapter(engine, memory, rootFn)`

Creates a tick source that reads FlatBuffer frames zero-copy from WASM memory. Plugs into `AnimationLoop`.

#### Interfaces

| Interface | Role |
|-----------|------|
| `IEngine` | Model contract: `tick()`, `addDataPoint()`, `openAction()`, `closeAction()` |
| `IFrameConsumer` | Receives `onFrame(frame, nowMs)` at 60fps. Has `priority` for ordering. |
| `IAnimationLoop` | `start()` / `stop()` / `addConsumer()` / `removeConsumer()` |
| `IChartRenderer` | Extends `IFrameConsumer` with `setData()`, `setTimeWindow()`, `resize()`, `destroy()` |
| `IEffectApplicator` | Extends `IFrameConsumer` with `bind()`, `unbind()`, `getCSSEffects()` |
| `IWasmIngestEngine` | WASM-side message parsing via `ingest_message()` |
| `IWasmBinaryIngestEngine` | Binary frame ingestion via `ingest_frame()` for server engine pipeline |

### View

#### `AnimationLoop`

60fps `requestAnimationFrame` loop. Calls `engine.tick()` once per frame, distributes the frame to consumers in priority order.

#### `EffectApplicator` (priority: 10)

Declarative frame-to-DOM bindings. Bind once at setup, applied every frame.

| Method | Description |
|--------|-------------|
| `bind(name, element)` | Register a DOM element by name |
| `bindCSSProperty(name, prop, extract, format?)` | `el.style.setProperty('--prop', extract(frame))` |
| `bindStyle(name, prop, extract, format?)` | `el.style[prop] = extract(frame)` |
| `bindTransform(name, extract, compute, threshold?)` | `el.style.transform = compute(extract(frame))` |
| `bindConditional(flagExtract, onTrue, onFalse?)` | Switch bindings based on boolean extractor |

#### `ChartDataConsumer` (priority: 0)

Version-gated chart data sync. Only copies data from WASM when `data_version()` changes. Library-agnostic via `ChartDataSink` interface.

#### `ThrottledStateSync` (priority: 20)

Bridges 60fps frame data to React at configurable intervals.

### Controller

#### `WebSocketPipeline`

Auto-reconnecting WebSocket with state machine, exponential backoff with jitter, staleness tracking, optional binary backpressure (rAF coalescing), and structured error surfacing. Supports binary + text messages and `send()` / `sendBinary()` for bidirectional communication.

**Connection state:** `ConnectionState` enum — `Disconnected` → `Connecting` → `Connected` → `Reconnecting` (on drop). Access via `pipeline.state`.

**Backoff:** Exponential with jitter. Base 1s, caps at 30s. Configure via `reconnectDelayMs` / `maxReconnectDelayMs`.

**Staleness:** `pipeline.stale` returns true when no message received within `staleThresholdMs` (default 5s). `pipeline.lastMessageTime` returns the raw timestamp.

**Backpressure:** Set `backpressure: true` to coalesce binary frames via `requestAnimationFrame` (latest-wins). Text messages pass through immediately.

**Error surfacing:** `pipeline.onError(handler)` fires `ConnectionError` with type (`connect_failed` | `connection_lost` | `max_retries_exhausted`), attempt count, and timestamp.

#### `WasmIngestParser`

Delegates raw WebSocket strings to the Rust engine's `ingest_message()` — all parsing happens in WASM.

#### `BinaryFrameParser`

Feeds binary FlatBuffer frames from a server engine to a WASM client engine via `ingest_frame()`.

#### `CommandBuilder` / `CommandSender<B>`

Two-class pattern for typed commands. Extend `CommandBuilder` with instance methods wrapping generated FlatBuffer statics (`b.startX()` instead of `X.startX(builder)`). Extend `CommandSender<B>` with typed command methods. Builder reuse, auto-incrementing IDs.

#### `SSEPipeline`

Auto-reconnecting Server-Sent Events pipeline implementing `IConnectionPipeline`. Same state machine, backoff, and staleness tracking as `WebSocketPipeline`. Read-only transport — `send()` is a no-op for Liskov substitutability.

**Config:** `url`, `eventTypes` (default `['message']`), `withCredentials`, plus same reconnect/staleness config as WS.

**Limitation:** `EventSource` does not support custom headers. Use URL query parameters or cookies for authentication.

**Swapping transports:**
```ts
// WebSocket path
const { pipeline, connected } = useConnection({ url: 'wss://...' });

// SSE path — same hook, same result shape
const sse = useMemo(() => new SSEPipeline({ url: '/events' }), []);
const { pipeline, connected } = useConnection(sse);
```

Both `WebSocketPipeline` and `SSEPipeline` implement `IConnectionPipeline`, so `useConnection()` accepts either.

#### `WorkerBridge`

Main-thread coordinator for off-main-thread WASM computation. Spawns a Worker, sends it a `SharedArrayBuffer`, and manages the lifecycle. The Worker runs the WASM engine on `setInterval` (~60fps) and writes frames into the SAB. The main thread reads the latest frame on each `requestAnimationFrame` tick — zero `postMessage` overhead per frame.

**Requires COOP/COEP headers** for `SharedArrayBuffer`:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Quick start (Worker path):**
```tsx
import { useWorker, useFrame } from 'org-asm/react';

const { loop, bridge, ready } = useWorker({
  workerUrl: new URL('./my-worker.ts', import.meta.url),
  frameSize: 39,
  wasmUrl: './pkg/my_engine_bg.wasm',
  engineConstructor: 'MyEngine',
});

const intensity = useFrame(loop, f => f[0], 100);
```

#### `SharedBufferTickSource`

Factory functions for creating tick sources that read from `SharedArrayBuffer`:

| Factory | Mode | Description |
|---------|------|-------------|
| `sharedBufferTickSource(buffer, frameSize)` | Float64Array | Zero-copy subarray view into SAB |
| `sharedBufferFlatBufferTickSource(buffer, maxBytes, rootFn)` | FlatBuffer | Copy + deserialize from SAB |
| `withSequenceTracking(source, buffer)` | Wrapper | Adds `.newFrame` boolean per tick |

#### `InputController`

Maps DOM events to engine actions with start/end lifecycle.

### Server (Rust templates)

#### `ServerEngine` trait

| Method | Description |
|--------|-------------|
| `ingest(&mut self, msg: &[u8]) -> bool` | Process raw exchange message, return true if state changed |
| `tick(&mut self, builder: &mut FlatBufferBuilder) -> &[u8]` | Serialize state to FlatBuffer bytes |
| `snapshot(&self, builder: &mut FlatBufferBuilder) -> Option<Vec<u8>>` | Optional full state for late-joining clients |

#### `BroadcastState`

Fan-out binary frames to all WebSocket clients via `tokio::sync::broadcast`.

#### Command Handler

Template for processing client commands (subscribe/unsubscribe). See `server/command-handler-template.rs`.

### CLI

| Command | Description |
|---------|-------------|
| `npx org-asm init <name>` | Scaffold full-stack project (WASM + server + shared + React) |
| `npx org-asm build` | Run `flatc` + `wasm-pack` + `cargo build` pipeline |
| `npx org-asm gen-builder <schema.fbs>` | Generate `CommandBuilder` subclass from FlatBuffers schema |

## FlatBuffers Schema Types

| FlatBuffers Type | Rust Type | TypeScript Accessor |
|------------------|-----------|---------------------|
| `double` | `f64` | `frame.intensity()` |
| `bool` | `bool` | `frame.isActive()` |
| `ubyte` | `u8` | `frame.colorR()` |
| `struct` | inline struct | zero-copy, no vtable |
| `[struct]` | `&[T]` | sequential cache-friendly access |

## Performance Design

- **1 WASM call per frame** — `tick()` serializes state into a FlatBuffer, JS reads zero-copy
- **Zero allocations in the render loop** — FlatBuffer bytes read directly from WASM linear memory
- **Version-gated data copies** — chart data only copied when `data_version()` changes
- **Throttled React updates** — 60fps data reaches React at ~10fps via `useFrame()` hook
- **Batched canvas rendering** — color-quantized Path2D batching reduces GPU state changes 10-30x
- **Shared Rust crate** — domain logic compiled once, used in both server (native) and client (WASM)
- **FlatBuffer commands** — typed bidirectional communication, builder reuse eliminates allocation

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `flatbuffers` | FlatBuffers runtime for typed frame deserialization |
| `react` (peer, optional) | React hooks for WASM + frame + connection state |
| `zustand` (peer, optional) | React state management with selector subscriptions |
| `rxjs` (peer, optional) | Throttled streams for high-frequency data bridging |
| `wasm-bindgen` (Rust) | Rust-JS boundary bindings |

Zero DOM library dependencies. Works with any chart library via `ChartDataSink`, any React version via hooks.

## Roadmap

- [x] FlatBuffers integration with `flatc` codegen
- [x] Server engine support (Rust/Axum with FlatBuffer broadcast)
- [x] Binary WebSocket pipeline (`BinaryFrameParser` + `onBinaryMessage`)
- [x] React hooks (`useWasm`, `useAnimationLoop`, `useFrame`, `useConnection`)
- [x] CLI scaffolding (`npx org-asm init`)
- [x] Build tooling (`npx org-asm build`)
- [x] Shared Rust crate template for server + WASM
- [x] Bidirectional commands (`CommandSender` + `commands.fbs`)
- [x] Connection state machine, exponential backoff, error surfacing
- [x] Staleness tracking and binary backpressure (rAF coalescing)
- [x] `RequestSnapshot` command for gap-free reconnection
- [x] Worker thread support for off-main-thread computation (`WorkerBridge` + `SharedBufferTickSource` + `useWorker`)
- [x] SSE/EventSource pipeline alongside WebSocket (`SSEPipeline` + `IConnectionPipeline`)
- [ ] Example apps (orderbook dashboard, sensor monitor)
- [ ] Benchmark suite

## License

MIT
