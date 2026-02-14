# orgASM

**Organized Assembly for Structured Motion.**

A Rust-first MVC framework for building 60fps React applications where computation lives in WebAssembly and TypeScript is reduced to a thin rendering layer.

---

## Problem

Real-time web apps — data visualization, simulations, live dashboards, trading interfaces — face a structural tension: computation runs at 60fps but React re-renders are expensive. The typical result is a tangle of `useRef`, `requestAnimationFrame`, manual DOM mutations, and ad-hoc throttling scattered across components. No separation of concerns. No testability. No reuse.

## Solution

orgASM provides a complete MVC architecture for real-time WASM+React applications:

- **Model** (Rust/WASM): Owns all state and computation. Returns a frame per tick — the frame type is generic (`Float64Array`, FlatBuffers, or any representation). One WASM call per frame instead of N getter calls.
- **View** (TypeScript): Applies frame data to DOM, canvas, and charts. Priority-ordered consumers handle data sync, visual effects, and React state updates at different rates.
- **Controller** (TypeScript): Routes external data (WebSocket) and user input to the Model. Handles connection lifecycle and message parsing.

At 60fps with 39 frame fields, the flat buffer protocol makes **60 boundary crossings/sec instead of 2,340**.

## Architecture

```
┌──────────────────────────────────────┐
│   SERVER ENGINE (Rust/Axum)          │
│   Optional upstream data processor   │
│   ServerEngine trait → ingest/tick   │
│   FlatBuffer serialize → broadcast   │
└──────────────────┬───────────────────┘
                   │ Binary WebSocket (FlatBuffer bytes)
┌──────────────────▼───────────────────┐
│          MODEL (Rust WASM)           │
│  Engine struct owns ALL state        │
│  tick(now_ms) → F (generic frame)    │
│  ingest_frame(&[u8]) ← server bytes │
│  One WASM call per frame             │
└──────────────────┬───────────────────┘
                   │ Frame (FlatBuffer)
┌──────────────────▼───────────────────┐
│          VIEW (TypeScript)           │
│  AnimationLoop    → orchestrates     │
│  EffectApplicator → DOM/CSS writes   │
│  ChartDataConsumer → chart library   │
│  ThrottledStateSync → React store    │
└──────────────────┬───────────────────┘
                   │ user events / data
┌──────────────────▼───────────────────┐
│       CONTROLLER (TypeScript)        │
│  WebSocketPipeline → data ingestion  │
│  BinaryFrameParser → binary frames   │
│  InputController   → user actions    │
│  MessageParser     → data routing    │
│  WasmBridge        → WASM lifecycle  │
└──────────────────────────────────────┘
```

### Three-Speed Data Flow

```
60fps:  Engine.tick() → Canvas/DOM         (module-level, zero React)
~10fps: ThrottledStateSync → Zustand       (React re-renders)
~1fps:  Config changes → Engine.set_*()    (user interaction)
```

These speeds never mix. 60fps data flows through the frame buffer and direct DOM writes. React only sees throttled snapshots at ~10fps. Configuration changes are infrequent method calls.

## Install

```bash
npm install org-asm
```

Peer dependencies: `zustand` (>=4), `rxjs` (>=7).

## Quick Start

### 1. Create Your Rust Engine

Copy the template and customize:

```bash
cp node_modules/org-asm/model/engine-template.rs crates/my-engine/src/engine.rs
cp node_modules/org-asm/model/Cargo.template.toml crates/my-engine/Cargo.toml
```

Define frame buffer offsets and implement `tick()`:

```rust
const F_INTENSITY: usize = 0;
const F_IS_ACTIVE: usize = 1;
const F_COLOR_R: usize = 2;
const F_COLOR_G: usize = 3;
const F_COLOR_B: usize = 4;
const FRAME_SIZE: usize = 5;

#[wasm_bindgen]
impl Engine {
    pub fn tick(&mut self, now_ms: f64) {
        self.frame.fill(0.0);
        self.smooth_value += (self.current_value - self.smooth_value) * 0.08;
        self.frame[F_INTENSITY] = self.smooth_value;
        self.frame[F_IS_ACTIVE] = if self.active { 1.0 } else { 0.0 };
        let color = compute_color(self.smooth_value);
        self.frame[F_COLOR_R] = color.0 as f64;
        self.frame[F_COLOR_G] = color.1 as f64;
        self.frame[F_COLOR_B] = color.2 as f64;
    }
}
```

Build:
```bash
wasm-pack build crates/my-engine --target web --release
```

### 2. Define Your Frame Schema

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

No custom codegen tool needed — `flatc` handles everything.

### 3. Wire the Animation Loop

```ts
import {
  AnimationLoop,
  EffectApplicator,
  ThrottledStateSync,
  flatBufferTickAdapter,
} from 'org-asm';
import init, { Engine } from '../pkg/my_engine';
import { Frame } from './generated/frame';
import { ByteBuffer } from 'flatbuffers';

const wasm = await init();
const engine = new Engine();

// Zero-copy tick: reads FlatBuffer frame directly from WASM memory
const tickSource = flatBufferTickAdapter(engine, wasm.memory,
  bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));
const loop = new AnimationLoop(tickSource);

// Declarative DOM effects — type-safe extractors from the schema
const effects = new EffectApplicator();
effects
  .bindCSSProperty('root', '--glow-alpha', f => f.intensity())
  .bindTransform('container', f => f.intensity(), (v) => {
    const x = (Math.random() - 0.5) * 2 * v;
    const y = (Math.random() - 0.5) * 2 * v;
    return `translate(${x}px, ${y}px)`;
  });
effects.bind('root', document.getElementById('app')!);

// Throttled React state bridge (100ms = ~10fps)
const stateSync = new ThrottledStateSync(100);
stateSync
  .setActiveFlag(f => f.isActive())
  .addMapping(
    (intensity) => store.getState().update(intensity),
    f => f.intensity(),
  );

// Start — consumers run in priority order
loop.addConsumer(effects);     // priority 10: DOM effects
loop.addConsumer(stateSync);   // priority 20: React last
loop.start();
```

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

The raw WebSocket string goes straight to WASM. No `JSON.parse`, no JS object allocation, no field extraction in TypeScript.

### 5. Server Engine (Optional)

For high-frequency data like orderbooks, run a server engine in native Rust that ingests exchange data and broadcasts FlatBuffer frames to all browser clients:

```bash
cp node_modules/org-asm/server/engine-trait.rs my-server/src/engine_trait.rs
cp node_modules/org-asm/server/broadcast.rs my-server/src/broadcast.rs
cp node_modules/org-asm/server/main-template.rs my-server/src/main.rs
cp node_modules/org-asm/server/Cargo.template.toml my-server/Cargo.toml
```

Implement the `ServerEngine` trait for your exchange:

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

On the client, receive binary frames with `BinaryFrameParser`:

```ts
import { WebSocketPipeline, BinaryFrameParser } from 'org-asm';

const parser = new BinaryFrameParser(engine)
  .onFrame(() => store.getState().update(engine.best_bid));

const ws = new WebSocketPipeline({
  url: 'ws://localhost:9001/ws',
  binaryType: 'arraybuffer',
});
ws.onBinaryMessage((data) => parser.ingestFrame(data));
ws.connect();
```

See `guides/server-engine-pattern.md` for the full architecture walkthrough.

### 6. Handle User Input

```ts
import { InputController } from 'org-asm';

const input = new InputController();
input.onAction('interact', {
  start: (params) => engine.open_action(params.mode, Date.now()),
  end: () => engine.close_action(Date.now()),
});
input.onActionEnd((name, result) => {
  console.log(`Action ${name} ended with result: ${result}`);
});

element.onmousedown = () => input.startAction('interact', { mode: 'draw' });
const cleanup = input.bindGlobalRelease();
```

## API Reference

### Core

#### `FrameBufferFactory`

Creates type-safe offset maps from schema definitions. Validates no offset collisions.

| Method | Description |
|--------|-------------|
| `createSchema(fields)` | Validates field descriptors, returns `FrameBufferSchema` |
| `createOffsets<T>(schema)` | Returns frozen `Record<T, number>` for `frame[F.FIELD]` access |
| `createAccessor<S>(frame, offsets)` | Wraps a `Float64Array` with `get()` / `getBool()` / `getU8()` |
| `validate(frame, schema)` | Checks `frame.length >= schema.size` |

#### Interfaces

| Interface | Role |
|-----------|------|
| `IEngine` | Model contract: `tick()`, `addDataPoint()`, `openAction()`, `closeAction()` |
| `IFrameConsumer` | Receives `onFrame(frame, nowMs)` at 60fps. Has `priority` for ordering. |
| `IAnimationLoop` | `start()` / `stop()` / `addConsumer()` / `removeConsumer()` |
| `IChartRenderer` | Extends `IFrameConsumer` with `setData()`, `setTimeWindow()`, `resize()`, `destroy()` |
| `IEffectApplicator` | Extends `IFrameConsumer` with `bind()`, `unbind()`, `getCSSEffects()` |
| `IDataPipeline` | `connect()` / `disconnect()` / `setParser()` |
| `IMessageParser` | `parse(raw, engine, nowMs) -> DataResult` |
| `IZeroCopyEngine` | Zero-alloc tick: `tick()` + `frame_ptr()` + `frame_len()` |
| `IZeroCopyDataSource` | Zero-copy data access via pointers into WASM linear memory |
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

#### `BatchedPathRenderer`

Groups canvas line segments by quantized color for efficient rendering. Reduces GPU state flushes from ~500 to ~16-32 per frame.

#### `ThrottledStateSync` (priority: 20)

Bridges 60fps frame data to React at configurable intervals.

| Method | Description |
|--------|-------------|
| `setActiveFlag(extract)` | Gate throttled updates on a boolean extractor |
| `addMapping(handler, ...extractors)` | Throttled: fires at most once per interval |
| `addConditionalMapping(flagExtract, handler)` | Immediate: fires every frame the flag is true |

### Controller

#### `WasmBridge`

Idempotent WASM initialization and engine factory.

#### `WebSocketPipeline`

Auto-reconnecting WebSocket with decoupled message handling.

#### `WasmIngestParser`

Delegates raw WebSocket strings to the Rust engine's `ingest_message()` — all parsing happens in WASM. Zero JS object allocation, one boundary crossing per message.

#### `BinaryFrameParser`

Feeds binary FlatBuffer frames from a server engine to a WASM client engine via `ingest_frame()`. Wire into `WebSocketPipeline.onBinaryMessage()`.

#### `InputController`

Maps DOM events to engine actions with start/end lifecycle.

### Server (Rust templates)

#### `ServerEngine` trait

Server-side engine that ingests exchange data and serializes state to FlatBuffer bytes for broadcast. See `server/engine-trait.rs`.

| Method | Description |
|--------|-------------|
| `ingest(&mut self, msg: &[u8]) -> bool` | Process raw exchange message, return true if state changed |
| `tick(&mut self, builder: &mut FlatBufferBuilder) -> &[u8]` | Serialize state to FlatBuffer bytes |
| `snapshot(&self, builder: &mut FlatBufferBuilder) -> Option<Vec<u8>>` | Optional full state for late-joining clients |

#### `BroadcastState`

Fan-out binary frames to all WebSocket clients via `tokio::sync::broadcast`. Serialize once, all clients share the same `Arc<Vec<u8>>`.

### Model (Store)

#### `createThrottledStream<T>(throttleMs)`

RxJS-backed throttled stream. Bridges high-frequency data to UI-safe rates.

#### `createRealtimeStore<State>(initialState, actions)`

Zustand store with `subscribeWithSelector` middleware for fine-grained re-renders.

#### `createModuleState<T>(initial)`

Module-level mutable state for 60fps data that bypasses React entirely.

## Frame Access Patterns

Consumers use extractor functions that read values from the frame. Since the frame type is generic, extractors work with any representation — FlatBuffers, typed arrays, plain objects, etc.

```ts
// Bind DOM effects to frame fields
effects.bindCSSProperty('root', '--value', f => f.intensity());
effects.bindTransform('container', f => f.shakeIntensity(), v => `translate(${v}px, 0)`);

// Sync to React state
stateSync.addMapping(handler, f => f.score(), f => f.elapsed());
stateSync.setActiveFlag(f => f.isActive());

// Conditional mapping — fires immediately when flag is true
stateSync.addConditionalMapping(f => f.sessionEnded(), frame => {
  store.getState().endSession(frame.finalScore());
});
```

### FlatBuffers Schema Types

| FlatBuffers Type | Rust Type | TypeScript Accessor |
|------------------|-----------|---------------------|
| `double` | `f64` | `frame.intensity()` |
| `bool` | `bool` | `frame.isActive()` |
| `ubyte` | `u8` | `frame.colorR()` |

## Consumer Priority Order

| Priority | Consumer | Rationale |
|----------|----------|-----------|
| 0 | `ChartDataConsumer` | Chart data is most latency-sensitive |
| 10 | `EffectApplicator` | DOM effects are visual but not data-critical |
| 20 | `ThrottledStateSync` | React updates are least latency-sensitive |

If a frame budget is exceeded, higher-priority consumers still receive their data.

## Performance Design

- **1 WASM call per frame** — `tick()` returns everything as a single frame (FlatBuffer or typed array)
- **Zero allocations in the JS render loop** — frame buffer comes from WASM linear memory
- **Version-gated data copies** — chart data only copied when `data_version()` changes
- **Throttled React updates** — 60fps data reaches React at ~10fps via `ThrottledStateSync`
- **Frozen offset objects** — V8 inlines property lookups from `Object.freeze()`
- **Batched canvas rendering** — color-quantized Path2D batching reduces GPU state changes 10-30x
- **Precomputed CSS values** — engine computes CSS-ready numbers, JS applies them directly

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `flatbuffers` | FlatBuffers runtime for typed frame deserialization |
| `zustand` (peer) | React state management with selector subscriptions |
| `rxjs` (peer) | Throttled streams for high-frequency data bridging |
| `wasm-bindgen` (Rust) | Rust-JS boundary bindings |

Zero DOM library dependencies. Works with any chart library via `ChartDataSink`, any React version via Zustand.

## Use Cases

- Real-time data visualization dashboards
- Trading and financial interfaces
- Physics simulations and interactive models
- Live sensor data monitoring
- Audio/music visualizers
- Game UIs with complex state

## Roadmap

- [x] Generic frame type support (FlatBuffers, Float64Array, or custom)
- [x] FlatBuffers integration with `flatc` codegen
- [x] Server engine support (Rust/Axum with FlatBuffer broadcast)
- [x] Binary WebSocket pipeline (`BinaryFrameParser` + `onBinaryMessage`)
- [ ] CLI scaffolding tool (`npx org-asm init`)
- [ ] Example apps (sensor dashboard, audio visualizer)
- [ ] Worker thread support for off-main-thread computation
- [ ] SSE/EventSource pipeline alongside WebSocket
- [ ] Benchmark suite comparing frame buffer vs N-getter patterns
- [ ] React hooks package (`useEngine`, `useFrameValue`)

## License

MIT
