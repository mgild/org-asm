# Skill: WASM+React MVC Architecture

## Overview

All logic that can live in Rust, lives in Rust. TypeScript handles rendering and I/O only.

```
+----------------------------------+
|         MODEL (Rust WASM)        |
|  ALL state, logic, validation    |
|  tick() --> FlatBuffer frame     |
|  Business rules, data transforms |
|  On-demand: validate, compute    |
+---------------+------------------+
                | FlatBuffer / method calls
+---------------v------------------+
|          VIEW (TypeScript)       |
|  AnimationLoop orchestrates      |
|  EffectApplicator --> DOM/CSS    |
|  ChartDataConsumer --> uPlot     |
|  ThrottledStateSync --> Zustand  |
+---------------+------------------+
                | user events
+---------------v------------------+
|       CONTROLLER (TypeScript)    |
|  WebSocketPipeline --> engine    |
|  InputController --> engine      |
|  MessageParser --> engine        |
|  WasmBridge --> initialization   |
+----------------------------------+
```

## Model: The Engine (Rust WASM)

**What**: A Rust struct compiled to WASM that owns all application state, business logic, and computation.

**Responsibility**: State management, validation, data transforms, business rules, real-time computation, derived values, formatting. Everything except rendering and browser I/O.

**Interface**:
```rust
#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine { ... }

    // Frame output (60fps hot path)
    pub fn tick(&mut self, now_ms: f64) -> Vec<f64> { ... }

    // Data input (medium frequency -- WebSocket messages)
    pub fn add_data_point(&mut self, value: f64, timestamp_sec: f64, now_ms: f64) { ... }
    pub fn load_history(&mut self, timestamps: &[f64], values: &[f64]) { ... }
    pub fn update_stats(&mut self, stat_a: f64, stat_b: f64, stat_c: f64) { ... }

    // Actions (user-triggered, infrequent)
    pub fn open_action(&mut self, option: bool, now_ms: f64) { ... }
    pub fn close_action(&mut self, now_ms: f64) -> f64 { ... }

    // Configuration (user settings, very infrequent)
    pub fn set_config(&mut self, key: &str, value: f64) { ... }

    // Data access (version-gated, only when data changes)
    pub fn data_version(&self) -> u32 { ... }
    pub fn get_timestamps(&self) -> Vec<f64> { ... }
    pub fn get_values(&self) -> Vec<f64> { ... }

    // Getters for post-message reads
    #[wasm_bindgen(getter)]
    pub fn current_value(&self) -> f64 { ... }
}
```

**Never does**: DOM manipulation, React state management, WebSocket I/O.

**Framework contracts**: Implements IEngine from `framework/core/interfaces.ts`.

**Guiding principle**: If logic can be expressed in Rust, it belongs in the Model. Validation, formatting, derived state, business rules, data transforms — all Rust. TypeScript only touches what requires browser APIs.

## View: The Rendering Layer (TypeScript)

**What**: TypeScript classes and functions that apply frame data to the UI.

**Responsibility**: DOM mutations, CSS property writes, canvas rendering, chart updates, throttled React state sync.

**Components**:

1. **AnimationLoop** (`framework/view/AnimationLoop.ts`)
   - Calls `engine.tick()` once per frame
   - Distributes the Float64Array to registered consumers
   - Priority-ordered: data sync (0) before effects (10) before React (20)
   - For multi-engine apps, use **MultiAnimationLoop** — single rAF loop with per-engine consumer lists via `EngineHandle<F>`

2. **EffectApplicator** (`framework/view/EffectApplicator.ts`)
   - Declarative bindings: map frame offsets to CSS properties
   - Handles custom properties, inline styles, transforms, conditionals
   - Priority 10 -- runs after chart data sync

3. **ChartDataConsumer** (`framework/view/ChartDataConsumer.ts`)
   - Version-gated data copying from WASM
   - Chart-library-agnostic via ChartDataSink interface
   - Priority 0 -- chart data is most latency-sensitive

4. **ThrottledStateSync** (`framework/view/ThrottledStateSync.ts`)
   - Bridges 60fps data to ~10fps React updates
   - Throttled mappings + immediate conditional mappings
   - Optional active flag to skip updates when no session is active
   - Priority 20 -- React is least latency-sensitive

**Never does**: Business logic, validation, data storage, WebSocket connections, state computation. If you're writing logic in the View, it probably belongs in the Model.

## Controller: The Routing Layer (TypeScript)

**What**: TypeScript classes that route data and user input to the Model.

**Responsibility**: WebSocket lifecycle, message parsing, user input handling, WASM initialization.

**Components**:

1. **WebSocketPipeline** (`framework/controller/WebSocketPipeline.ts`)
   - Connection management with auto-reconnect
   - Routes raw messages to handlers
   - Decoupled from message parsing (handler does the parsing)

2. **InputController** (`framework/controller/InputController.ts`)
   - Maps DOM events to engine method calls
   - Named actions with start/end lifecycle
   - Global release listener for mouseup/touchend

3. **WasmBridge** (`framework/controller/WasmBridge.ts`)
   - Idempotent WASM initialization
   - Engine instance creation by constructor name

**Never does**: Computation, rendering, state storage.

## Data Flow: Detailed Walk-Through

### 1. Data arrives via WebSocket
```
Controller: ws.onmessage --> handleWsMessage(raw)
```

### 2. Controller parses and routes to Model
```
Controller: JSON.parse(raw) --> engine.add_data_point(value, timestamp, now)
Controller: emitValue(engine.current_value)  --> throttled RxJS stream
```

### 3. Model stores data, bumps version
```
Model: self.current_value = value
Model: self.timestamps.push(timestamp)
Model: self.data_version += 1
```

### 4. View's AnimationLoop calls Model.tick()
```
View: const frame = engine.tick(Date.now())
```

### 5. Model computes all values, returns frame buffer
```
Model: smooth_intensity += (target - smooth_intensity) * 0.08
Model: frame[F_VIG_ALPHA] = blend * (0.3 + 0.3 * t_ramp)
Model: return frame  // 39 precomputed f64 values
```

### 6. View distributes frame to consumers
```
View (priority 0):  ChartDataConsumer checks version, copies data if changed
View (priority 10): EffectApplicator applies CSS properties to DOM
View (priority 20): ThrottledStateSync updates Zustand at 10fps
```

### 7. React re-renders from throttled store
```
React: useAppStore(s => s.currentValue) --> re-render ValueDisplay
```

## On-Demand and Async Data Paths

The tick loop handles 60fps rendering. Other data paths use dedicated hooks:

### Synchronous On-Demand
User actions trigger direct engine method calls. Results return immediately — no frame buffer involved:

```
User clicks "Validate" --> Controller: engine.validate(input) --> Model returns result
                           View: useWasmCall(() => engine.validate(input), [input])
```

### Reactive State (Event-Driven)
External events mutate engine state. A notifier triggers React re-reads:

```
WebSocket message --> Controller: engine.ingest(data); notifier.notify()
                      View: useWasmState(notifier, () => engine.balance())
                      React re-renders with new balance
```

### Async Computation
Heavy computation runs off-thread via WasmTaskWorker. The hook manages loading/result/error:

```
User requests optimization --> Controller: worker.call('optimize', params)
                               View: useAsyncWasmCall(() => worker.call(...), [params])
                               React shows loading -> result
```

### Streaming Results
Long computations yield incremental results via callbacks:

```
User starts analysis --> Controller: engine.analyze(data, emit)
                         View: useWasmStream((emit) => engine.analyze(data, emit), [data])
                         React accumulates chunks -> done
```

### Data Flow Speed Summary

```
60fps:      Engine.tick() → Canvas/DOM           (module-level, zero React)
~10fps:     useFrame() / ThrottledStateSync      (React re-renders)
on-demand:  useWasmCall() / useWasmState()       (user actions, events)
async:      useAsyncWasmCall()                   (worker offload, fetch)
streaming:  useWasmStream()                      (large dataset processing)
reducer:    useWasmReducer()                     (forms, CRUD, state machines)
~1fps:      Config changes → Engine.set_*()      (user settings)
```

## Why This Architecture Works

**Rust owns all logic**: Validation, business rules, data transforms, state management — all in Rust with real types, ownership, and predictable performance. TypeScript is left with the one thing it's good at: browser API access.

**Shared across tiers**: The same Rust crate compiles to native (server) and WASM (client). No logic duplication. A validation rule written once runs everywhere.

**Minimal WASM boundary crossings**: For real-time paths, 1 `tick()` call per frame returns all state via FlatBuffer. For on-demand paths, direct method calls return results immediately.

**No shared mutable state**: The Model (Rust) owns all data. JS never mutates engine state directly — it calls methods that the engine controls.

**Works beyond 60fps** — The same Rust-first principle applies to forms, dashboards, and CRUD apps. `useWasmReducer` gives React's reducer pattern with Rust owning all state and transitions. `createWasmContext` shares the engine across components without prop drilling. Not every app needs an animation loop.

**Testable**: The Model is pure Rust — test with `cargo test`, no browser needed. Test the View by feeding it synthetic frame buffers. Test the Controller by mocking WebSocket connections.

**Reusable**: The same engine works with different Views (swap uPlot for lightweight-charts, swap DOM effects for canvas-only rendering). The same View framework works with different engines (trading, gaming, visualization).

## Store Architecture

The Zustand store holds ONLY React UI state. It is NOT the source of truth for animation data:

```ts
interface AppState {
    // UI state (updated at 10fps via throttled streams)
    currentValue: number;
    prevValue: number;
    stats: StatsData;
    session: Session;
    cumulativeResult: number;

    // User configuration (updated on interaction)
    configA: number;
    configB: number;
    showSettings: boolean;
}
```

The store factory provides `subscribeWithSelector` middleware so components only re-render when their specific slice changes:

```ts
const useAppStore = create<AppState>()(
    subscribeWithSelector((set, get) => ({
        // ...state and actions...
    }))
);

// Component subscribes to one field -- only re-renders when value changes
const value = useAppStore(s => s.currentValue);
```

## File Organization
```
framework/
  core/
    types.ts             # FrameFieldDescriptor, TimeSeriesData, CSSEffect
    interfaces.ts        # IEngine, IAnimationLoop, IFrameConsumer, etc.
    FrameBuffer.ts       # FrameBufferFactory for type-safe offset access
    index.ts             # Barrel export
  model/
    StoreFactory.ts      # createThrottledStream, createRealtimeStore
    engine-template.rs   # Rust engine template with step-by-step guide
    Cargo.template.toml  # Cargo.toml with wasm-bindgen, opt-level z
    index.ts             # Barrel export
  view/
    AnimationLoop.ts     # 60fps loop with consumer registry (single engine)
    MultiAnimationLoop.ts # Shared rAF loop for multiple engines
    EffectApplicator.ts  # Declarative DOM effect bindings
    ChartDataConsumer.ts # Version-gated chart data sync
    ThrottledStateSync.ts # Throttled React state bridge
    index.ts             # Barrel export
  controller/
    WebSocketPipeline.ts # Auto-reconnecting WebSocket
    InputController.ts   # DOM event --> engine action mapper
    WasmBridge.ts        # WASM initialization lifecycle
```
