# AGENTS.md — AI Agent Quick Reference for org-asm

## Core Principle

**All logic that can live in Rust, lives in Rust.** TypeScript handles rendering and I/O only. The Rust WASM engine is the single source of truth for state, validation, computation, and business rules.

## Architecture (MVC)

```
MODEL (Rust WASM)     — State, logic, validation, computation
VIEW (TypeScript)     — DOM/canvas rendering, React hooks, CSS effects
CONTROLLER (TypeScript) — WebSocket/SSE I/O, user input routing, WASM lifecycle
```

## Import Paths

```ts
import { /* types, interfaces */ } from 'org-asm/core';
import { /* hooks */ } from 'org-asm/react';
import { /* pipelines, bridges, workers */ } from 'org-asm/controller';
import { /* animation loops, effect applicators */ } from 'org-asm/view';
import { /* store factories */ } from 'org-asm/model';
```

## Hook Decision Tree

```
What does the component need?

Real-time animation (60fps)?
  → useFrame(loop, extract, throttleMs)

Synchronous value from engine (validation, formatting, derived)?
  → useWasmCall(() => engine.method(args), [deps])

React to external state changes (WebSocket, events)?
  → useWasmState(notifier, () => engine.snapshot())
  → Call notifier.notify() after engine mutation

Async operation (fetch-in-WASM, worker offload)?
  → useAsyncWasmCall(() => engine.asyncMethod(args), [deps])
  → Returns { result, loading, error }

Streaming/chunked results?
  → useWasmStream((emit) => engine.process(data, emit), [deps])
  → Returns { chunks, done, error }

Full state management (forms, CRUD, dashboards)?
  → useWasmReducer(engine, { getSnapshot, dispatch })
  → Returns [state, dispatch]

Share engine across component tree?
  → createWasmContext<MyEngine>()
  → Returns { WasmProvider, useEngine, useNotifier }
```

## Common Patterns

### Wire a WebSocket to an engine
```ts
const { pipeline, connected } = useConnection({ url: 'wss://...' });
const notifier = useMemo(() => createNotifier(), []);

useEffect(() => {
  if (!engine) return;
  pipeline.onMessage(raw => { engine.ingest_message(raw, Date.now()); notifier.notify(); });
}, [pipeline, engine, notifier]);

const balance = useWasmState(notifier, () => engine.balance());
```

### Validate a form field
```ts
const result = useWasmCall(
  () => parseResult(engine.validate_field('price', price)),
  [price],
);
if (!result.ok) showError(result.error);
```

### Offload heavy computation to a worker
```ts
const worker = useMemo(() => new WasmTaskWorker({
  workerUrl: new URL('./compute-worker.ts', import.meta.url),
  wasmUrl: './pkg/engine_bg.wasm',
  engineConstructor: 'Engine',
}), []);

const { result, loading } = useAsyncWasmCall(
  () => worker.call('optimize', { data }),
  [data],
);
```

### 60fps rendering with React throttling
```ts
const { memory, ready } = useWasm(() => init());
const engine = useMemo(() => ready ? new Engine() : null, [ready]);
const loop = useAnimationLoop(engine, memory, bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));
const intensity = useFrame(loop, f => f.intensity(), 100); // 10fps React updates
```

### Reducer for non-animation apps
```ts
const [state, dispatch] = useWasmReducer(engine, {
  getSnapshot: (e) => ({ items: e.get_items(), total: e.total() }),
  dispatch: (e, action) => {
    if (action.type === 'add') e.add_item(action.name, action.price);
    if (action.type === 'remove') e.remove_item(action.id);
  },
});
```

## File Map

### Hooks (`react/`)
| Hook | Purpose |
|------|---------|
| `useWasm` | Initialize WASM module |
| `useAnimationLoop` | Create 60fps loop with FlatBuffer adapter |
| `useEngine` | Register engine on shared MultiAnimationLoop |
| `useFrame` | Throttled frame value subscription |
| `useWasmCall` | Sync on-demand WASM call |
| `useWasmState` | Reactive state via useSyncExternalStore |
| `useAsyncWasmCall` | Async WASM call with loading/error |
| `useWasmStream` | Streaming chunked results |
| `useWasmReducer` | Rust-first useReducer |
| `createWasmContext` | Shared engine context factory |
| `useConnection` | WebSocket/SSE with state tracking |
| `useWorker` | Off-main-thread WASM via SharedArrayBuffer |
| `useResponseRegistry` | Command response correlation |
| `useSubscriptionManager` | Auto-replay subscriptions on reconnect |

### Controller (`controller/`)
| Class | Purpose |
|-------|---------|
| `WebSocketPipeline` | Auto-reconnecting WebSocket with backoff, staleness, middleware |
| `SSEPipeline` | Auto-reconnecting SSE (same interface as WebSocket) |
| `WasmBridge` | WASM init lifecycle |
| `WorkerBridge` | Frame-oriented worker (SharedArrayBuffer + tick interval) |
| `WasmTaskWorker` | Request/response worker (Promise-based, one-off computation) |
| `InputController` | DOM events to engine actions |
| `MessageParser` | Route messages to engine methods |
| `CommandSender` | Typed FlatBuffer commands with async responses |
| `ResponseRegistry` | Correlate command responses by ID |
| `SubscriptionManager` | Track + replay subscriptions on reconnect |

### View (`view/`)
| Class | Purpose |
|-------|---------|
| `AnimationLoop` | 60fps rAF loop, single engine |
| `MultiAnimationLoop` | Shared rAF loop, multiple engines |
| `EffectApplicator` | Declarative frame-to-DOM bindings |
| `ChartDataConsumer` | Version-gated chart data sync |
| `ThrottledStateSync` | Bridge 60fps data to React at ~10fps |

### Core (`core/`)
| Export | Purpose |
|--------|---------|
| `WasmResult<T>` | Discriminated union for fallible WASM methods |
| `WasmNotifier` | Pub/sub interface for useWasmState |
| `IEngine<F>` | Model contract (tick, addDataPoint, openAction) |
| `IAnimationLoop<F>` | Loop contract (start, stop, addConsumer) |
| `IFrameConsumer<F>` | Per-frame callback with priority ordering |

## Anti-Patterns (Never Do)

1. **Business logic in TypeScript** — Validation, state machines, derived values, formatting belong in the Rust engine
2. **useState for 60fps data** — Use module-level variables or useFrame with throttling
3. **Multiple WASM calls per frame** — One `tick()` returns everything via FlatBuffer
4. **Duplicating state in JS** — Engine is the single source of truth
5. **useEffect for validation** — Use useWasmCall (synchronous, no extra render cycle)
6. **Storing errors in React state** — Read error state from engine via getSnapshot
7. **JSON.parse in WASM** — Parse in JS (native C++), pass primitives to engine
8. **Allocations in animation loop** — Pre-allocate buffers, reuse per frame

## Guides (Read Order)

1. `guides/mvc-architecture.md` — Architecture overview, layer responsibilities
2. `guides/wasm-engine-pattern.md` — Engine design, frame buffer, hook mental model
3. `guides/realtime-rendering.md` — 60fps patterns, animation loop, canvas plugins
4. `guides/data-pipeline.md` — WebSocket to engine to React data flow
5. `guides/form-validation.md` — Rust-owned validation, useWasmCall + WasmResult
6. `guides/frame-buffer-design.md` — FlatBuffer frame protocol, zero-copy reads
7. `guides/server-engine-pattern.md` — Server-side Rust engine, FlatBuffer broadcast

## Rust Engine Conventions

```rust
#[wasm_bindgen]
impl Engine {
    // Constructor
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine { ... }

    // 60fps hot path — returns FlatBuffer frame
    pub fn tick(&mut self, now_ms: f64) { ... }
    pub fn frame_ptr(&self) -> *const u8 { ... }
    pub fn frame_len(&self) -> usize { ... }

    // Data ingestion — called from WebSocket handler
    pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 { ... }
    pub fn ingest_frame(&mut self, bytes: &[u8]) { ... }

    // On-demand — called from useWasmCall / useWasmReducer
    pub fn validate_field(&self, field: &str, value: &str) -> String { ... }
    pub fn format_amount(&self, value: f64, decimals: u32) -> String { ... }

    // State snapshots — called from useWasmState / useWasmReducer
    pub fn balance(&self) -> f64 { ... }
    pub fn data_version(&self) -> u32 { ... }

    // Actions — called from InputController / dispatch
    pub fn open_action(&mut self, params: &str, now_ms: f64) { ... }
    pub fn close_action(&mut self, now_ms: f64) -> f64 { ... }
}
```

## CLI Commands

```bash
npx org-asm init <name>           # Scaffold full-stack project
npx org-asm build                 # flatc + wasm-pack + cargo build
npx org-asm gen-builder <fbs>     # TS builder + sender + hook from FlatBuffers
npx org-asm gen-handler <fbs>     # Rust CommandHandler trait from FlatBuffers
```
