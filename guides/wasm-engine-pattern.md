# Skill: WASM Engine Pattern

## When to Use
When building any application where logic belongs in Rust:
- State management — ownership and mutation controlled by Rust, not scattered across JS
- Validation and business rules — write once in Rust, run on server (native) and client (WASM)
- Real-time computation — 60fps animations, simulations, data visualization
- Data transforms — parsing, aggregation, derived values
- Performance-sensitive paths — boundary crossings are the bottleneck, not computation

## The Pattern

### 1. Engine Owns All State
The Rust WASM struct owns ALL mutable state. No shared state with JS.

```rust
#[wasm_bindgen]
pub struct Engine {
    // ALL state here -- data, animation, config
    timestamps: Vec<f64>,
    values: Vec<f64>,
    smooth_value: f64,
    blend: f64,
    // ...
}
```

Why: The engine is the single source of truth. Duplicating state in JS creates synchronization bugs. When one side mutates without the other knowing, you get visual glitches, stale data, and race conditions that are nearly impossible to debug at 60fps.

### 2. Flat Frame Buffer Protocol
Instead of returning a struct with N getter methods (N boundary crossings), return a flat `Vec<f64>` (1 boundary crossing).

```rust
// Frame buffer offsets (must match JS F constants exactly)
const F_SMOOTH_INTENSITY: usize = 0;
const F_ACTION_BLEND: usize = 1;
const F_PULSE: usize = 2;
const F_RESULT_R: usize = 3;
const F_RESULT_G: usize = 4;
const F_RESULT_B: usize = 5;
const F_IS_ACTIVE: usize = 6;
const F_VALUE: usize = 7;
// ...
const FRAME_SIZE: usize = 8;

pub fn tick(&mut self, now_ms: f64) -> Vec<f64> {
    let mut frame = vec![0.0; FRAME_SIZE];
    // Compute everything...
    frame[F_SMOOTH_INTENSITY] = self.smooth_value;
    frame[F_ACTION_BLEND] = self.blend;
    // ...
    frame
}
```

JS reads by offset using a mirrored constant object:
```ts
const F = {
  SMOOTH_INTENSITY: 0,
  ACTION_BLEND: 1,
  PULSE: 2,
  RESULT_R: 3, RESULT_G: 4, RESULT_B: 5,
  IS_ACTIVE: 6,
  VALUE: 7,
} as const;

const frame = engine.tick(Date.now());
element.style.opacity = String(frame[F.ACTION_BLEND]);
```

Why: wasm-bindgen can return `Vec<f64>` as a single memcpy into JS Float64Array. Returning a struct with `#[wasm_bindgen]` getters generates N separate WASM calls per frame. At 60fps with 39 fields (like the reference implementation), that is 2,340 boundary crossings/sec vs 60. The flat buffer wins by 39x.

### 3. One Call Per Frame
The entire animation frame is computed in ONE `tick()` call. JS becomes a thin rendering layer that just applies precomputed values. Everything -- smoothing, color interpolation, animation easing, CSS property values -- is computed inside `tick()`.

```rust
// Inside tick():
// 1. Exponential smoothing
self.smooth_intensity += (score_intensity - self.smooth_intensity) * 0.08;

// 2. Blend animations
let blend_target = if self.is_active { 1.0 } else { 0.0 };
self.action_blend += (blend_target - self.action_blend) * 0.04;

// 3. CSS-ready values (precomputed, not computed in JS)
let vig_alpha = blend * (0.3 + 0.3 * t_ramp + 0.2 * pulse * t_ramp);
let border_alpha = blend * (0.1 + 0.35 * pulse * t_ramp);

// 4. Fill frame
frame[F_VIG_ALPHA] = vig_alpha;
frame[F_BORDER_ALPHA] = border_alpha;
```

### 4. Data Versioning
Chart data is only copied from WASM when it changes. The engine maintains a monotonically increasing version counter bumped on every data mutation:

```rust
// In engine:
data_version: u32,

pub fn add_data_point(&mut self, value: f64, timestamp_sec: f64, now_ms: f64) {
    // ... store data ...
    self.data_version += 1;
}

#[wasm_bindgen]
pub fn data_version(&self) -> u32 {
    self.data_version
}
```

```ts
// In animation loop:
let lastDataVersion = 0;
let chartTimestamps: ArrayLike<number> = [];
let chartValues: ArrayLike<number> = [];

// Inside animate():
const ver = engine.data_version();
if (ver !== lastDataVersion) {
    chartTimestamps = engine.get_timestamps();
    chartValues = engine.get_values();
    lastDataVersion = ver;
}
```

Why: At 60fps with data arriving ~50 messages/sec, roughly 20% of frames have no new data. Skipping the Float64Array copy on those frames avoids unnecessary allocations.

### 5. Parse in JS, Compute in WASM
`JSON.parse` in the browser is a C++ native function. Do not add `serde_json` to WASM (it adds ~30KB). Parse in JS, pass primitives to engine methods:

```ts
const handleWsMessage = (raw: string) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'data') {
        const value = parseFloat(msg.value);
        const timestampSec = msg.timestamp / 1000;
        engine.add_data_point(value, timestampSec, Date.now());
    }
};
```

```rust
#[wasm_bindgen]
pub fn add_data_point(&mut self, value: f64, timestamp_sec: f64, now_ms: f64) {
    self.prev_value = self.value;
    self.value = value;
    // ... process ...
}
```

## Non-Tick Data Paths

Not all WASM interaction happens at 60fps. The framework provides hooks for every call pattern:

### Synchronous On-Demand (`useWasmCall`)
For validation, formatting, derived values — any synchronous engine method called when React deps change:

```ts
const isValid = useWasmCall(() => engine.validate(input), [input]);
const formatted = useWasmCall(() => engine.format_amount(value, 2), [value]);
```

Thin wrapper over `useMemo`. The name signals "WASM boundary crossing."

### Reactive State (`useWasmState`)
When external events (WebSocket, user actions) mutate engine state outside the tick loop:

```ts
const notifier = useMemo(() => createNotifier(), []);
pipeline.onMessage(raw => { engine.ingest_message(raw); notifier.notify(); });

const balance = useWasmState(notifier, () => engine.balance());
```

Uses `useSyncExternalStore` under the hood. Re-reads snapshot only when `notify()` is called.

### Async Calls (`useAsyncWasmCall`)
Three async patterns, one hook:

1. **wasm-bindgen-futures** — Rust `async fn` calling JS APIs (fetch, IndexedDB):
   ```ts
   const { result, loading, error } = useAsyncWasmCall(
     () => engine.fetch_and_process(url), [url],
   );
   ```

2. **Worker offload** — heavy computation off main thread via `WasmTaskWorker`:
   ```ts
   const worker = useMemo(() => new WasmTaskWorker(config), []);
   const { result, loading, error } = useAsyncWasmCall(
     () => worker.call('optimize', { data }), [data],
   );
   ```

3. **Any Promise** — works with any async operation returning a Promise.

Latest-wins cancellation: when deps change, stale results are discarded.

### Streaming Results (`useWasmStream`)
For long computations yielding results incrementally:

```ts
const { chunks, done, error } = useWasmStream(
  (emit) => engine.process_large_dataset(data, emit),
  [data],
);
```

Chunks are batched via `requestAnimationFrame` to avoid excessive re-renders.

### Hook Mental Model

| Hook | Trigger | Blocking? | Use Case |
|------|---------|-----------|----------|
| `useWasmCall(fn, deps)` | React deps change | Sync | Validation, formatting, derived values |
| `useDebouncedWasmCall(fn, deps, ms)` | React deps change | Sync (debounced) | Search, autocomplete, filter-as-you-type |
| `useWasmState(notifier, snap)` | Explicit notify | Sync | Balance, counts, externally-mutated state |
| `useWasmSelector(notifier, snap, eq?)` | Explicit notify | Sync | Object snapshots without re-render churn |
| `useAsyncWasmCall(fn, deps)` | React deps change | Async | Fetch-in-WASM, worker offload |
| `useWasmStream(fn, deps)` | React deps change | Streaming | Large dataset processing, progress |
| `useWasmReducer(engine, config)` | Dispatch action | Sync/Async | CRUD apps, forms, state machines |
| `useFrame(loop, extract, ms)` | Animation tick | Sync (60fps) | CSS effects, animations, real-time charts |

### Reducer Pattern (`useWasmReducer`)
For non-animation apps (forms, dashboards, CRUD), the engine owns all state and the reducer pattern replaces React's `useReducer`:

```ts
const [state, dispatch] = useWasmReducer(engine, {
  getSnapshot: (e) => ({ items: e.get_items(), total: e.total() }),
  dispatch: (e, action) => {
    if (action.type === 'add') e.add_item(action.name, action.price);
    if (action.type === 'remove') e.remove_item(action.id);
  },
});
dispatch({ type: 'add', name: 'Widget', price: 9.99 });
```

All transition logic lives in Rust. TypeScript dispatches actions and renders snapshots.

### Shared Engine Context (`createWasmContext`)
Share an engine + notifier across a component tree without prop drilling:

```ts
// context.ts
export const { WasmProvider, useEngine, useNotifier } = createWasmContext<MyEngine>();

// App.tsx
<WasmProvider engine={engine} notifier={notifier}>
  <Dashboard />
</WasmProvider>

// Any descendant
const engine = useEngine();
const balance = useWasmState(useNotifier(), () => engine.balance());
```

## Anti-Patterns to Avoid
1. **Individual WASM calls per value** -- Each getter/setter crosses the boundary. Use the frame buffer instead.
2. **Struct return types** -- wasm-bindgen generates getter methods for struct fields = N boundary crossings per access.
3. **JSON parsing in WASM** -- Adds ~30KB via serde_json, slower than native JSON.parse in V8.
4. **Shared mutable state** -- JS and WASM fighting over the same data creates sync bugs invisible at 60fps.
5. **React state for 60fps data** -- Causes 60 re-renders/sec. Use module-level variables for animation state.
6. **Allocations inside tick()** -- The only allocation should be the frame Vec itself. No string operations, no new objects.

## File Structure
```
crates/my-engine/src/
  lib.rs          # mod declarations + pub use
  engine.rs       # Main Engine struct + tick()
  helpers.rs      # Internal computation helpers (color lerp, math)
  Cargo.toml      # wasm-bindgen, js-sys, opt-level "z"

src/
  components/App.tsx  # Thin rendering layer
  store/store.ts      # Zustand (React UI state only, throttled)
  wasm/init.ts        # WASM initialization

framework/
  core/               # Types, interfaces, FrameBufferFactory
  model/              # Engine template, StoreFactory
  view/               # AnimationLoop, EffectApplicator, ChartDataConsumer
  controller/         # WebSocketPipeline, InputController, WasmBridge
```

## Concrete Example: Reference Implementation
The reference implementation demonstrates this pattern with 39 frame buffer fields covering:
- Animation state: blend, pulse, beat, entry flash, t_ramp
- Score computation: intensity, percent, absolute value, derived metrics
- Color interpolation: RGB components computed per-frame
- CSS effects: vignette alpha, border glow, scanline, shake intensity
- Display values: progress, timer opacity/scale, window seconds
- Session state: is_active, session_type, entry/threshold/limit values

All 39 values computed in a single `tick()` call, returned as one `Vec<f64>`.
