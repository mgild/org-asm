# Skill: WASM+React MVC Architecture

## Overview

```
+----------------------------------+
|         MODEL (Rust WASM)        |
|  Engine struct owns ALL state    |
|  tick() --> flat frame buffer    |
|  One WASM call per frame         |
+---------------+------------------+
                | Vec<f64>
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

**What**: A Rust struct compiled to WASM that owns all state and computation.

**Responsibility**: State management, animation math, data storage, derived values, color interpolation, CSS effect computation.

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

**Never does**: DOM manipulation, React state management, WebSocket I/O, JSON parsing.

**Framework contracts**: Implements IEngine from `framework/core/interfaces.ts`.

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

**Never does**: Business logic, data storage, WebSocket connections, computation beyond trivial formatting.

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

## Why This Architecture Works

**Minimal WASM boundary crossings**: 1 `tick()` call per frame returns everything. The Engine computes 39 values in one call vs 39 separate calls with a traditional getter-based approach.

**No shared mutable state**: The Model (Rust) owns all data. JS never mutates engine state directly -- it calls methods that the engine controls.

**Clear separation of concerns**: Each layer has one job. The View never computes derived values. The Model never touches the DOM. The Controller never stores state.

**Testable**: Mock any layer independently. Test the engine with pure Rust unit tests (no browser needed). Test the View by feeding it synthetic frame buffers. Test the Controller by mocking WebSocket connections.

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
