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
│          MODEL (Rust WASM)           │
│  Engine struct owns ALL state        │
│  tick(now_ms) → F (generic frame)    │
│  One WASM call per frame             │
└──────────────────┬───────────────────┘
                   │ Float64Array
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

### 2. Choose Your Frame Format

#### Option A: FlatBuffers (recommended for new projects)

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

#### Option B: Float64Array (simpler, still fully supported)

Annotate your Rust `F_*` constants with type hints in trailing comments:

```rust
const F_INTENSITY: usize = 0;  // f64 - Smoothed value
const F_IS_ACTIVE: usize = 1;  // bool - Active flag
const F_COLOR_R: usize = 2;    // u8 - Red channel
const FRAME_SIZE: usize = 3;
```

Create your TypeScript schema manually or with a codegen tool:

```ts
import { FrameBufferFactory } from 'org-asm';

export const schema = FrameBufferFactory.createSchema([
  { name: 'INTENSITY', offset: 0, type: 'f64' },
  { name: 'IS_ACTIVE', offset: 1, type: 'bool' },
  { name: 'COLOR_R', offset: 2, type: 'u8' },
]);

export const F = FrameBufferFactory.createOffsets<'INTENSITY' | 'IS_ACTIVE' | 'COLOR_R'>(schema);

export const FRAME_SIZE = 3;
```

### 3. Wire the Animation Loop

```ts
import {
  AnimationLoop,
  EffectApplicator,
  ChartDataConsumer,
  ThrottledStateSync,
  flatBufferTickAdapter,  // FlatBuffers path
  zeroCopyTickAdapter,    // Float64Array path
} from 'org-asm';
import init, { Engine } from '../pkg/my_engine';
import { Frame } from './generated/frame';
import { ByteBuffer } from 'flatbuffers';

const wasm = await init();
const engine = new Engine();

// --- FlatBuffers path (recommended) ---
const tickSource = flatBufferTickAdapter(engine, wasm.memory,
  bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));
const loop = new AnimationLoop(tickSource);

const effects = new EffectApplicator();
effects
  .bindCSSProperty('root', '--glow-alpha', f => f.intensity())
  .bindTransform('container', f => f.intensity(), (v) => {
    const x = (Math.random() - 0.5) * 2 * v;
    const y = (Math.random() - 0.5) * 2 * v;
    return `translate(${x}px, ${y}px)`;
  });
effects.bind('root', document.getElementById('app')!);

const stateSync = new ThrottledStateSync(100);
stateSync
  .setActiveFlag(f => f.isActive())
  .addMapping(
    (intensity) => store.getState().update(intensity),
    f => f.intensity(),
  );

// --- Float64Array alternative ---
// const tickSource = zeroCopyTickAdapter(engine, wasm.memory, FRAME_SIZE);
// const loop = new AnimationLoop(tickSource);
// effects.bindCSSProperty('root', '--glow-alpha', f => f[F.INTENSITY]);
// stateSync.setActiveFlag(f => f[F.IS_ACTIVE] > 0.5);
```

### 4. Connect a Data Source

```ts
import { WebSocketPipeline, MessageParser } from 'org-asm';
import type { EngineDataTarget, DataResult } from 'org-asm';

class MyParser extends MessageParser {
  parse(raw: string, engine: EngineDataTarget, nowMs: number): DataResult {
    const msg = JSON.parse(raw);
    if (msg.type === 'data') {
      engine.addDataPoint(parseFloat(msg.value), msg.timestamp / 1000, nowMs);
      return { dataUpdated: true, statsUpdated: false };
    }
    return { dataUpdated: false, statsUpdated: false };
  }
}

const ws = new WebSocketPipeline({ url: 'wss://your-source/ws' });
const adapter = { addDataPoint: (v, t, n) => engine.add_data_point(v, t, n) };
const parser = new MyParser();
ws.onMessage((raw) => parser.parse(raw, adapter, Date.now()));
ws.connect();
```

### 5. Handle User Input

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

### View

#### `AnimationLoop`

60fps `requestAnimationFrame` loop. Calls `engine.tick()` once per frame, distributes the `Float64Array` to consumers in priority order.

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

#### `MessageParser` / `WasmIngestParser`

Abstract base for data source parsers. `WasmIngestParser` delegates parsing to WASM for high-frequency feeds.

#### `InputController`

Maps DOM events to engine actions with start/end lifecycle.

### Model (Store)

#### `createThrottledStream<T>(throttleMs)`

RxJS-backed throttled stream. Bridges high-frequency data to UI-safe rates.

#### `createRealtimeStore<State>(initialState, actions)`

Zustand store with `subscribeWithSelector` middleware for fine-grained re-renders.

#### `createModuleState<T>(initial)`

Module-level mutable state for 60fps data that bypasses React entirely.

## Frame Access Patterns

### Extractor functions (generic, works with any frame type)
```ts
effects.bindCSSProperty('root', '--value', f => f.intensity());
stateSync.addMapping(handler, f => f.score(), f => f.elapsed());
```

### Float64Array offsets (backward compatible)
```ts
effects.bindCSSProperty('root', '--value', f => f[F.INTENSITY]);
stateSync.addMapping(handler, f => f[F.SCORE], f => f[F.ELAPSED]);
```

## Frame Buffer Conventions

| Type | Encoding | Read Pattern |
|------|----------|-------------|
| **f64** | Raw number | `frame[F.VALUE]` |
| **bool** | `0.0` / `1.0` | `frame[F.FLAG] > 0.5` |
| **u8** (color) | `0-255` as f64 | `Math.round(frame[F.COLOR_R])` |
| **one-frame flag** | Set to `1.0`, engine clears next tick | Handler must be idempotent |

Rust constants use `F_` prefix. TypeScript offsets use no prefix. Both sides must match exactly.

## Consumer Priority Order

| Priority | Consumer | Rationale |
|----------|----------|-----------|
| 0 | `ChartDataConsumer` | Chart data is most latency-sensitive |
| 10 | `EffectApplicator` | DOM effects are visual but not data-critical |
| 20 | `ThrottledStateSync` | React updates are least latency-sensitive |

If a frame budget is exceeded, higher-priority consumers still receive their data.

## Performance Design

- **1 WASM call per frame** — `tick()` returns everything as a single `Float64Array`
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
- [ ] CLI scaffolding tool (`npx org-asm init`)
- [ ] Example apps (sensor dashboard, audio visualizer)
- [ ] Worker thread support for off-main-thread computation
- [ ] SSE/EventSource pipeline alongside WebSocket
- [ ] Benchmark suite comparing frame buffer vs N-getter patterns
- [ ] React hooks package (`useEngine`, `useFrameValue`)

## License

MIT
