//! # WASM Engine Template (FlatBuffers)
//!
//! This template demonstrates the TradingEngine pattern for building
//! high-performance WASM engines that own all state and computation.
//!
//! ## Architecture
//! - Engine owns ALL mutable state (no shared state with JS)
//! - `tick(now_ms)` serializes state into a FlatBuffer frame
//! - JS reads the frame zero-copy from WASM linear memory via `frame_ptr()`
//! - One WASM call per animation frame (minimizes boundary crossings)
//! - JS becomes a thin rendering layer: read frame -> apply to DOM
//!
//! ## Why FlatBuffers?
//! The `.fbs` schema is the single source of truth for both Rust and TypeScript.
//! `flatc` generates type-safe code for both sides — no manual offset constants,
//! no f64 encoding of bools/bytes, proper types throughout.
//!
//! At 60fps with 20 fields:
//!   - N getters: 20 WASM calls/frame = 1,200/sec
//!   - FlatBuffer: 1 WASM call + zero-copy read = 60/sec
//!
//! ## How to use this template
//! 1. Define your `.fbs` schema in `schema/frame.fbs`
//! 2. Generate Rust code: `flatc --rust -o src/generated/ schema/frame.fbs`
//! 3. Generate TS code: `flatc --ts -o src/generated/ schema/frame.fbs`
//! 4. Copy this file and rename it (e.g., `my_engine.rs`)
//! 5. Replace the generated import path and Frame type with yours
//! 6. Define your engine struct with all state fields (Step 2)
//! 7. Implement constructor, data input, tick(), and data access (Step 3)
//! 8. Use `flatBufferTickAdapter()` from the framework to wire into AnimationLoop

use wasm_bindgen::prelude::*;
use flatbuffers::FlatBufferBuilder;
use serde::Deserialize;

// Import generated FlatBuffer types from your schema.
// Replace this path with your actual generated module.
// use crate::generated::frame_generated::*;

// ============================================
// STEP 1: Define constants
//
// Move ALL constants from JS into Rust.
// The engine is the single source of truth for behavior.
// JS should only hold rendering constants (font sizes, etc).
//
// Why? Constants scattered across JS and Rust cause subtle
// bugs when they drift. Centralizing in Rust means one place
// to audit, and the compiler catches type errors.
// ============================================

/// Threshold below which changes are ignored (prevents jitter)
const SOME_THRESHOLD: f64 = 0.05;

/// Exponential smoothing factor: higher = more responsive, lower = smoother.
/// At 0.08 with 60fps, the smoothed value reaches 95% of target in ~50 frames (~830ms).
const SMOOTHING_FACTOR: f64 = 0.08;

/// How many seconds of time-series data to retain.
/// Older data is pruned on each `add_data_point()` call.
const HISTORY_WINDOW_SEC: f64 = 30.0;

// ============================================
// STEP 2: Define the engine struct
//
// ALL mutable state lives here. No globals, no thread_local!,
// no lazy_static!. The JS side holds a single Engine instance
// and passes it to every function.
//
// Group fields by lifecycle:
//   - Time-series data: grows/shrinks over time
//   - Current state: latest snapshot values
//   - Animation state: persists across frames, smoothly transitions
//   - Configuration: set from JS, changes infrequently
//   - FlatBufferBuilder: reused across tick() calls (no allocation per frame)
// ============================================

#[wasm_bindgen]
pub struct Engine {
    // --- Time-series data (owned by engine) ---
    // These grow with each data point and are pruned by age.
    // Stored as parallel Vec<f64> for cache-friendly iteration
    // and easy return via get_timestamps()/get_values().
    timestamps: Vec<f64>,
    values: Vec<f64>,

    // Monotonically increasing version number. JS compares this to
    // its cached version to know when to re-read chart data.
    // Avoids copying timestamps/values every frame.
    data_version: u32,

    // --- Current state ---
    // Latest values from data input. Used for tick() computations.
    current_value: f64,
    prev_value: f64,

    // --- Animation state (persists across frames) ---
    // These are NOT reset each frame. They accumulate over time
    // to produce smooth animations.
    smooth_value: f64,     // Exponentially smoothed value
    blend_factor: f64,     // Transition animation progress 0.0 -> 1.0

    // --- Configuration (set from JS) ---
    // Changed infrequently (user settings, parameter changes).
    // Having dedicated setters avoids parsing config objects in WASM.
    config_a: f64,
    config_b: f64,

    // --- FlatBuffer builder (reused across tick() calls) ---
    // The builder owns an internal byte buffer that grows as needed.
    // reset() clears it without deallocating, so tick() is allocation-free
    // after the first call.
    builder: FlatBufferBuilder<'static>,
}

// ============================================
// STEP 3: Implement the engine
//
// Method categories:
//   - Constructor: new()
//   - Configuration: set_*() — called infrequently
//   - Data input: add_data_point(), load_history() — called on WS messages
//   - Frame output: tick() — called once per rAF (60fps)
//   - Frame access: frame_ptr(), frame_len() — zero-copy read from JS
//   - Data access: get_*() — called when version changes
//
// The key insight: tick() is the hot path. Everything else is cold.
// Optimize tick() relentlessly. Other methods can be straightforward.
// ============================================

#[wasm_bindgen]
impl Engine {
    // --- Constructor ---
    // Called once when the WASM module initializes.
    // Sets all state to sensible defaults.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine {
            timestamps: Vec::new(),
            values: Vec::new(),
            data_version: 0,
            current_value: 0.0,
            prev_value: 0.0,
            smooth_value: 0.0,
            blend_factor: 0.0,
            config_a: 1.0,
            config_b: 1.0,
            builder: FlatBufferBuilder::with_capacity(256),
        }
    }

    // --- Configuration setters ---
    //
    // Called infrequently from JS (e.g., user changes settings).
    // Each setter is a single WASM call. Prefer individual setters
    // over a single set_config(json) because:
    //   1. No JSON parsing overhead in WASM
    //   2. Type-safe at the boundary
    //   3. Can change one setting without touching others
    #[wasm_bindgen]
    pub fn set_config_a(&mut self, v: f64) {
        self.config_a = v;
    }

    #[wasm_bindgen]
    pub fn set_config_b(&mut self, v: f64) {
        self.config_b = v;
    }

    // --- Data input ---
    //
    // Called on each WebSocket message (10-100/sec for trading data).
    // This is a medium-frequency path. Keep it efficient but don't
    // micro-optimize like tick().
    //
    // Pattern: accept primitives (f64), not objects.
    #[wasm_bindgen]
    pub fn add_data_point(&mut self, value: f64, timestamp_sec: f64, now_ms: f64) {
        // Track previous value for direction detection (up/down arrows, colors)
        self.prev_value = self.current_value;
        self.current_value = value;

        // Append to time-series
        self.timestamps.push(timestamp_sec);
        self.values.push(value);

        // Prune old data outside the history window.
        // saturating_sub(1) ensures we always keep at least 1 data point.
        let cutoff = now_ms / 1000.0 - HISTORY_WINDOW_SEC;
        let mut cut = 0;
        while cut < self.timestamps.len().saturating_sub(1) && self.timestamps[cut] < cutoff {
            cut += 1;
        }
        if cut > 0 {
            // drain(0..cut) removes elements and shifts the rest down.
            // For very large datasets, consider a ring buffer instead.
            self.timestamps.drain(0..cut);
            self.values.drain(0..cut);
        }

        // Bump version so JS knows to re-read chart data
        self.data_version += 1;
    }

    // --- Historical data loading ---
    //
    // Called once on initialization to backfill from REST API.
    // Accepts slices (&[f64]) which map to JS Float64Array — zero-copy on input.
    #[wasm_bindgen]
    pub fn load_history(&mut self, timestamps: &[f64], values: &[f64]) {
        if timestamps.len() != values.len() {
            return; // Silently reject mismatched arrays
        }

        for i in 0..timestamps.len() {
            self.timestamps.push(timestamps[i]);
            self.values.push(values[i]);
        }

        // Initialize current/prev from last historical value
        // so the first live data point has a valid previous value.
        if let Some(&last) = values.last() {
            self.current_value = last;
            self.prev_value = last;
            self.smooth_value = last;
        }

        self.data_version += 1;
    }

    // ========================================
    // THE MAIN METHOD: tick()
    //
    // Called once per requestAnimationFrame (60fps).
    // Serializes ALL computed values into a FlatBuffer frame.
    //
    // The builder is reused across calls — reset() clears the
    // internal buffer without deallocating. After the first tick,
    // this is allocation-free.
    //
    // JS reads the finished bytes zero-copy via frame_ptr()/frame_len()
    // using the flatBufferTickAdapter() from the framework.
    //
    // Rules for tick():
    //   1. Call builder.reset() first
    //   2. No string operations
    //   3. No branching on data length (handle empty gracefully)
    //   4. All state mutations happen here (animations, smoothing)
    // ========================================
    #[wasm_bindgen]
    pub fn tick(&mut self, _now_ms: f64) {
        self.builder.reset();

        // 1. Exponential smoothing (persistent state across frames)
        //
        // smooth_value chases current_value at a rate controlled by SMOOTHING_FACTOR.
        // This runs every frame regardless of whether new data arrived,
        // producing smooth animation even with bursty data.
        self.smooth_value += (self.current_value - self.smooth_value) * SMOOTHING_FACTOR;

        // 2. Blend animation (approaches target asymptotically)
        let blend_target = if self.current_value > SOME_THRESHOLD { 1.0 } else { 0.0 };
        self.blend_factor += (blend_target - self.blend_factor) * 0.04;

        // 3. Compute derived values
        let normalized = if self.config_a != 0.0 {
            (self.smooth_value / self.config_a).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let color = compute_color(normalized);

        // 4. Build FlatBuffer frame
        //
        // Replace with your generated Frame type and FrameArgs.
        // The field types match the .fbs schema exactly:
        //   double → f64, bool → bool, ubyte → u8
        //
        // let frame = Frame::create(&mut self.builder, &FrameArgs {
        //     value_a: self.smooth_value,
        //     value_b: self.blend_factor,
        //     state_flag: self.current_value > self.prev_value,
        //     color_r: color.0,
        //     color_g: color.1,
        //     color_b: color.2,
        // });
        // self.builder.finish(frame, None);
    }

    // --- Zero-copy FlatBuffer access ---
    //
    // JS reads the finished FlatBuffer bytes directly from WASM linear memory.
    // No copy, no allocation — just a Uint8Array view into the builder's buffer.
    //
    // Use framework's flatBufferTickAdapter() to wire into AnimationLoop:
    //
    //   import { Frame } from './generated/frame';
    //   import { ByteBuffer } from 'flatbuffers';
    //
    //   const tick = flatBufferTickAdapter(engine, wasm.memory,
    //     bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));
    //   const loop = new AnimationLoop(tick);
    #[wasm_bindgen]
    pub fn frame_ptr(&self) -> *const u8 {
        self.builder.finished_data().as_ptr()
    }

    #[wasm_bindgen]
    pub fn frame_len(&self) -> usize {
        self.builder.finished_data().len()
    }

    // --- Data access methods ---
    //
    // Used by JS to get chart/graph data. Only called when data_version changes.
    //
    // Pattern: JS caches the last data_version it read. On each frame:
    //   if (engine.data_version() !== cachedVersion) {
    //     timestamps = engine.get_timestamps();
    //     values = engine.get_values();
    //     cachedVersion = engine.data_version();
    //   }
    #[wasm_bindgen]
    pub fn get_timestamps(&self) -> Vec<f64> {
        self.timestamps.clone()
    }

    #[wasm_bindgen]
    pub fn get_values(&self) -> Vec<f64> {
        self.values.clone()
    }

    /// Monotonically increasing version counter.
    /// Bumped on every data mutation. JS uses this to avoid
    /// unnecessary data copies (only re-read when version changes).
    #[wasm_bindgen]
    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    // --- Zero-copy data access ---
    //
    // Instead of cloning Vec<f64> on each call (O(n) copy), expose
    // raw pointers so JS can create Float64Array views directly.
    // Use framework's ChartDataConsumer.zeroCopy() to integrate.
    //
    // IMPORTANT: Views must be recreated after any operation that
    // might grow WASM memory (Vec push causes reallocation).
    #[wasm_bindgen]
    pub fn timestamps_ptr(&self) -> *const f64 {
        self.timestamps.as_ptr()
    }

    #[wasm_bindgen]
    pub fn timestamps_len(&self) -> usize {
        self.timestamps.len()
    }

    #[wasm_bindgen]
    pub fn values_ptr(&self) -> *const f64 {
        self.values.as_ptr()
    }

    #[wasm_bindgen]
    pub fn values_len(&self) -> usize {
        self.values.len()
    }

    // --- Getters for post-message reads ---
    //
    // These are for values JS needs OUTSIDE the animation loop,
    // e.g., to sync React state after a WebSocket message.
    #[wasm_bindgen(getter)]
    pub fn current_value(&self) -> f64 {
        self.current_value
    }

    // --- WASM-side message parsing (recommended) ---
    //
    // All data processing belongs in Rust. Raw WebSocket strings go straight
    // to WASM where serde_json parses them — one boundary crossing, zero JS
    // object allocation, zero GC pressure.
    //
    // Use the framework's WasmIngestParser to wire this into WebSocketPipeline:
    //   const parser = new WasmIngestParser(engine);
    //   ws.onMessage((raw) => parser.parse(raw, engine, Date.now()));
    //
    // Return bitmask: bit 0 = data updated, bit 1 = stats updated.
    //
    // Customize the Deserialize struct to match your data source:

    #[wasm_bindgen]
    pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 {
        #[derive(Deserialize)]
        struct Msg {
            value: f64,
            timestamp: f64,
        }

        let msg: Msg = match serde_json::from_str(raw) {
            Ok(m) => m,
            Err(_) => return 0,
        };
        self.add_data_point(msg.value, msg.timestamp, now_ms);
        1 // INGEST_DATA_UPDATED
    }

    // --- Binary frame ingestion (server engine pipeline) ---
    //
    // When using a server engine that broadcasts FlatBuffer frames over binary
    // WebSocket, the client WASM engine receives pre-serialized bytes and
    // deserializes them to update its state. Use BinaryFrameParser from the
    // framework to wire this into WebSocketPipeline.
    //
    // #[wasm_bindgen]
    // pub fn ingest_frame(&mut self, bytes: &[u8]) {
    //     let frame = flatbuffers::root::<OrderbookFrame>(bytes).unwrap();
    //     self.best_bid = frame.best_bid();
    //     self.best_ask = frame.best_ask();
    //     self.mid_price = frame.mid_price();
    //     self.spread = frame.spread();
    //     // ... update other fields from the FlatBuffer frame ...
    //     self.data_version += 1;
    // }
}

// ============================================
// STEP 4: Internal helpers (not exported to JS)
//
// These are pure functions called from tick().
// Keep them small and inlineable. The compiler will
// often inline them into tick() for zero overhead.
// ============================================

/// Map a normalized 0..1 value to an RGB color.
///
/// This example does a simple red-green gradient.
/// Replace with your own color logic (e.g., diverging palette,
/// discrete thresholds, HSL interpolation).
fn compute_color(value: f64) -> (u8, u8, u8) {
    let t = value.clamp(0.0, 1.0);
    // Green (0,200,0) at t=0 -> Red (255,0,0) at t=1
    let r = (255.0 * t).round() as u8;
    let g = (200.0 * (1.0 - t)).round() as u8;
    let b = 0_u8;
    (r, g, b)
}

// ============================================
// OPTIONAL: Advanced patterns
// ============================================

// --- Ring buffer alternative for high-frequency data ---
//
// If add_data_point() is called 1000+/sec, Vec::drain() becomes expensive.
// Use a ring buffer instead:
//
// struct RingBuffer {
//     data: Vec<f64>,
//     head: usize,
//     len: usize,
//     capacity: usize,
// }
//
// This avoids shifting elements on every prune.

// --- Multi-engine composition ---
//
// For complex UIs with multiple independent data streams,
// create multiple Engine instances in JS:
//
//   const priceEngine = new Engine();
//   const volumeEngine = new Engine();
//
// Each engine has its own state and tick(). The animation loop
// calls tick() on each and merges the frame buffers:
//
//   function animate(now) {
//     priceEngine.tick(now);
//     volumeEngine.tick(now);
//     render(priceFrame, volumeFrame);
//     requestAnimationFrame(animate);
//   }

// --- Testing ---
//
// Test the engine with #[cfg(test)] mod tests.
// WASM engines are pure state machines — easy to unit test
// without any browser or DOM dependencies.
//
// #[cfg(test)]
// mod tests {
//     use super::*;
//
//     #[test]
//     fn test_smoothing_converges() {
//         let mut engine = Engine::new();
//         engine.add_data_point(100.0, 0.0, 0.0);
//         for _ in 0..100 {
//             engine.tick(0.0);
//         }
//         // smooth_value should have converged toward 100.0
//         assert!((engine.current_value() - 100.0).abs() < 0.01);
//     }
// }
