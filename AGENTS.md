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

## Hook Selection

| Scenario | Hook | Signature | Returns |
|----------|------|-----------|---------|
| 60fps animation values | `useFrame` | `(loop, extract, ms?)` | `T \| null` |
| Sync engine call on deps change | `useWasmCall` | `(fn, deps)` | `T` |
| Debounced engine call | `useDebouncedWasmCall` | `(fn, deps, ms)` | `T \| null` |
| React to external state (primitives) | `useWasmState` | `(notifier, getSnapshot)` | `T` |
| React to external state (objects) | `useWasmSelector` | `(notifier, getSnapshot, isEqual?)` | `T` |
| Async operation (Promise) | `useAsyncWasmCall` | `(fn, deps)` | `{ result, loading, error }` |
| Streaming/chunked results | `useWasmStream` | `(fn, deps)` | `{ chunks, done, error }` |
| Full state management (no tick loop) | `useWasmReducer` | `(engine, config)` | `[S, dispatch]` |
| Share engine across component tree | `createWasmContext` | `<E>()` | `{ WasmProvider, useEngine, useNotifier }` |
| Catch WASM panics | `WasmErrorBoundary` | component | Renders fallback on error |
| WebSocket/SSE connection | `useConnection` | `(config)` | `{ pipeline, connected, state, error, stale }` |
| Off-thread WASM (frame-oriented) | `useWorker` | `(config)` | `{ loop, bridge, ready, error }` |

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

### Batch rapid-fire mutations
```ts
pipeline.onBinaryMessage(data => {
  notifier.batch(() => {
    for (const msg of parseMessages(data)) {
      engine.ingest(msg);
      notifier.notify(); // suppressed during batch
    }
  }); // single notify fires here
});
```

### Catch WASM panics
```ts
<WasmErrorBoundary
  fallback={({ error, reset }) => (
    <div>
      <p>Engine crashed: {error.message}</p>
      <button onClick={reset}>Restart</button>
    </div>
  )}
  onError={reportToSentry}
  onReset={() => reinitializeEngine()}
>
  <App />
</WasmErrorBoundary>
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

### Search with debounce
```ts
const results = useDebouncedWasmCall(
  () => engine.search(query, 20),
  [query],
  200,
);
```

### Object snapshot without re-render churn
```ts
// BAD: re-renders every notify() because new object each time
const book = useWasmState(notifier, () => ({ bid: engine.bid(), ask: engine.ask() }));

// GOOD: shallow equality skips re-render when values unchanged
const book = useWasmSelector(notifier, () => ({ bid: engine.bid(), ask: engine.ask() }));
```

## Anti-Patterns

| Never Do | Instead |
|----------|---------|
| Business logic in TypeScript | Put in Rust engine |
| `useState` for 60fps data | `useFrame` with throttling, or module-level vars |
| Multiple WASM calls per frame | One `tick()` returns everything via FlatBuffer |
| Duplicate state in JS | Engine is single source of truth |
| `useEffect` for validation | `useWasmCall` (sync, no extra render) |
| Store errors in React state | Read from engine via `getSnapshot` |
| `JSON.parse` in WASM | Parse in JS (native C++), pass primitives |
| Allocate in animation loop | Pre-allocate buffers, reuse per frame |
| `useWasmState` with object snapshots | `useWasmSelector` (shallow equality) |
| Raw `notify()` in tight loops | `notifier.batch(() => { ... })` |

## File Map

### Hooks (`react/`)
| Hook | Purpose |
|------|---------|
| `useWasm` | Initialize WASM module |
| `useAnimationLoop` | Create 60fps loop with FlatBuffer adapter |
| `useEngine` | Register engine on shared MultiAnimationLoop |
| `useFrame` | Throttled frame value subscription |
| `useWasmCall` | Sync on-demand WASM call |
| `useDebouncedWasmCall` | Debounced sync WASM call (search/autocomplete) |
| `useWasmState` | Reactive state via useSyncExternalStore |
| `useWasmSelector` | Like useWasmState with structural equality |
| `useAsyncWasmCall` | Async WASM call with loading/error |
| `useWasmStream` | Streaming chunked results |
| `useWasmReducer` | Rust-first useReducer |
| `createWasmContext` | Shared engine context factory |
| `WasmErrorBoundary` | Error boundary for WASM panics with reset |
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

## Generating Rust Engine Code

When creating a new engine, follow this template:

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MyEngine {
    // ALL mutable state here — never in JS
    data_version: u32,
}

#[wasm_bindgen]
impl MyEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MyEngine {
        MyEngine { data_version: 0 }
    }

    // Mutators bump data_version so useWasmState/useWasmSelector re-read
    pub fn set_value(&mut self, v: f64) {
        // ... mutate state ...
        self.data_version += 1;
    }

    // Snapshots are &self (read-only) — called from getSnapshot
    pub fn value(&self) -> f64 { 0.0 }
    pub fn data_version(&self) -> u32 { self.data_version }

    // Validation returns JSON string for WasmResult parsing
    pub fn validate_field(&self, field: &str, value: &str) -> String {
        String::new()
    }
}
```

Key rules:
- `&mut self` methods = mutations (called from dispatch/handlers)
- `&self` methods = snapshots (called from getSnapshot/useWasmCall)
- Bump `data_version` on every state change
- Return simple types (f64, u32, String, bool) -- not structs

## CLI Commands

```bash
npx org-asm init <name>           # Scaffold full-stack project
npx org-asm build                 # flatc + wasm-pack + cargo build
npx org-asm gen-builder <fbs>     # TS builder + sender + hook from FlatBuffers
npx org-asm gen-handler <fbs>     # Rust CommandHandler trait from FlatBuffers
```
