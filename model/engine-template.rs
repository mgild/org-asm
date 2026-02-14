//! # WASM Engine Template
//!
//! This template demonstrates the TradingEngine pattern for building
//! high-performance WASM engines that own all state and computation.
//!
//! ## Architecture
//! - Engine owns ALL mutable state (no shared state with JS)
//! - `tick(now_ms)` returns a flat Vec<f64> frame buffer
//! - One WASM call per animation frame (minimizes boundary crossings)
//! - JS becomes a thin rendering layer: read frame -> apply to DOM
//!
//! ## Pattern: Frame Buffer Protocol
//! Instead of returning structs with getters (N boundary crossings),
//! return a flat Vec<f64> with known offsets (1 boundary crossing).
//! JS reads values by index: frame[OFFSET_PRICE], frame[OFFSET_PNL], etc.
//!
//! ## Why flat Vec<f64>?
//! wasm-bindgen can return Vec<f64> as a single copy into JS Float64Array.
//! Returning a struct with #[wasm_bindgen] getters means N separate calls
//! across the WASM boundary per frame. At 60fps with 20 fields, that's
//! 1,200 boundary crossings/sec vs 60. The flat buffer wins decisively.
//!
//! ## Zero-copy optimization (advanced)
//! For maximum performance, the engine can write to a persistent internal buffer
//! instead of allocating a new Vec<f64> per frame. JS reads directly from WASM
//! linear memory via `frame_ptr()` — zero allocation, zero copy.
//! Use `zeroCopyTickAdapter()` from the framework to integrate with AnimationLoop.
//!
//! ## WASM-side message parsing (advanced)
//! For high-frequency data feeds, raw WebSocket strings can be parsed in WASM
//! via serde_json. This eliminates JS object allocation and reduces boundary
//! crossings. Use `WasmIngestParser` from the framework to integrate.
//!
//! ## How to use this template
//! 1. Copy this file and rename it (e.g., `my_engine.rs`)
//! 2. Define your frame buffer offsets (Step 1)
//! 3. Define your constants (Step 2)
//! 4. Define your engine struct with all state fields (Step 3)
//! 5. Implement constructor, data input, tick(), and data access (Step 4)
//! 6. Add internal helpers (Step 5)
//! 7. Create matching JS frame offset constants (see framework/view/)

use wasm_bindgen::prelude::*;
use serde::Deserialize;

// ============================================
// STEP 1: Define frame buffer offsets
//
// These MUST match the JS F constants exactly.
// Convention: prefix with F_ in Rust, no prefix in JS.
//
// The frame buffer is the contract between Rust and JS.
// Adding a field means updating BOTH sides. Keep them
// in a single block so drift is easy to spot.
//
// Rule: offsets are sequential integers starting at 0.
// FRAME_SIZE is always the count of fields.
// ============================================

const F_VALUE_A: usize = 0;     // Primary computed value
const F_VALUE_B: usize = 1;     // Secondary computed value
const F_STATE_FLAG: usize = 2;  // Boolean encoded as 0.0/1.0
const F_COLOR_R: usize = 3;     // Color component (0-255 as f64)
const F_COLOR_G: usize = 4;
const F_COLOR_B: usize = 5;
// ... add more fields as needed
const FRAME_SIZE: usize = 6;    // Total number of fields

// ============================================
// STEP 2: Define constants
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

/// Duration for blend/transition animations (milliseconds)
const ANIMATION_DURATION_MS: f64 = 1000.0;

/// Exponential smoothing factor: higher = more responsive, lower = smoother.
/// At 0.08 with 60fps, the smoothed value reaches 95% of target in ~50 frames (~830ms).
const SMOOTHING_FACTOR: f64 = 0.08;

/// How many seconds of time-series data to retain.
/// Older data is pruned on each `add_data_point()` call.
const HISTORY_WINDOW_SEC: f64 = 30.0;

// ============================================
// STEP 3: Define the engine struct
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

    // --- Persistent frame buffer (zero-copy optimization) ---
    // Avoids allocating a new Vec<f64> on every tick() call.
    // JS reads directly from WASM linear memory via frame_ptr().
    frame: Vec<f64>,
}

// ============================================
// STEP 4: Implement the engine
//
// Method categories:
//   - Constructor: new()
//   - Configuration: set_*() — called infrequently
//   - Data input: add_data_point(), load_history() — called on WS messages
//   - Frame output: tick() — called once per rAF (60fps)
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
            frame: vec![0.0; FRAME_SIZE],
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
    // Parse JSON in JS, pass numbers to WASM. JSON parsing in JS
    // is native C++ code and faster than serde_json in WASM.
    #[wasm_bindgen]
    pub fn add_data_point(&mut self, value: f64, timestamp_sec: f64, now_ms: f64) {
        // Track previous value for direction detection (up/down arrows, colors)
        self.prev_value = self.current_value;
        self.current_value = value;

        // Append to time-series
        self.timestamps.push(timestamp_sec);
        self.values.push(value);

        // Prune old data outside the history window.
        // We scan from the front (oldest) and remove everything before cutoff.
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
            // Also initialize smooth_value to avoid a long ramp-up
            // from 0 to the actual value on first render.
            self.smooth_value = last;
        }

        self.data_version += 1;
    }

    // ========================================
    // THE MAIN METHOD: tick()
    //
    // Called once per requestAnimationFrame (60fps).
    // Returns ALL computed values as a flat f64 array.
    //
    // This is where the real performance win is:
    // ONE wasm call replaces N getter/setter pairs.
    //
    // At 60fps with 20 fields:
    //   - Without frame buffer: 20 WASM calls/frame = 1,200/sec
    //   - With frame buffer: 1 WASM call/frame = 60/sec
    //   - With zero-copy: 1 WASM call + 0 copies = 60/sec + ~0 allocs
    //
    // Rules for tick():
    //   1. No allocations except the frame Vec (consider reusing)
    //   2. No string operations
    //   3. No branching on data length (handle empty gracefully)
    //   4. All state mutations happen here (animations, smoothing)
    // ========================================
    #[wasm_bindgen]
    pub fn tick(&mut self, _now_ms: f64) {
        self.frame.fill(0.0);

        // 1. Exponential smoothing (persistent state across frames)
        //
        // smooth_value chases current_value at a rate controlled by SMOOTHING_FACTOR.
        // This runs every frame regardless of whether new data arrived,
        // producing smooth animation even with bursty data.
        self.smooth_value += (self.current_value - self.smooth_value) * SMOOTHING_FACTOR;

        // 2. Blend animation (approaches target asymptotically)
        //
        // blend_factor transitions from 0->1 or 1->0 based on state.
        // The 0.04 factor means ~95% complete in 75 frames (~1.25 sec at 60fps).
        // Adjust this constant to control transition speed.
        let blend_target = if self.current_value > SOME_THRESHOLD { 1.0 } else { 0.0 };
        self.blend_factor += (blend_target - self.blend_factor) * 0.04;

        // 3. Compute derived values
        //
        // All computation happens in Rust. JS never computes — it only renders.
        // This keeps the rendering layer trivially simple and testable.
        let normalized = if self.config_a != 0.0 {
            (self.smooth_value / self.config_a).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let color = compute_color(normalized);

        // 4. Fill frame buffer
        //
        // Order MUST match the F_ constants defined above.
        // Each value is a plain f64. Booleans become 0.0/1.0.
        // Colors become 0-255 integers cast to f64.
        // Strings are NOT supported — use numeric codes instead.
        self.frame[F_VALUE_A] = self.smooth_value;
        self.frame[F_VALUE_B] = self.blend_factor;
        self.frame[F_STATE_FLAG] = if self.current_value > self.prev_value { 1.0 } else { 0.0 };
        self.frame[F_COLOR_R] = color.0 as f64;
        self.frame[F_COLOR_G] = color.1 as f64;
        self.frame[F_COLOR_B] = color.2 as f64;
    }

    // --- Zero-copy frame buffer access ---
    //
    // Instead of returning Vec<f64> from tick() (which wasm-bindgen copies
    // into a new JS Float64Array), expose a pointer to the persistent buffer.
    // JS creates a Float64Array VIEW into WASM memory — zero allocation:
    //
    //   engine.tick(nowMs);
    //   const frame = new Float64Array(memory.buffer, engine.frame_ptr(), FRAME_SIZE);
    //
    // Use framework's zeroCopyTickAdapter() to wrap this into the AnimationLoop
    // interface automatically.
    #[wasm_bindgen]
    pub fn frame_ptr(&self) -> *const f64 {
        self.frame.as_ptr()
    }

    #[wasm_bindgen]
    pub fn frame_len(&self) -> usize {
        FRAME_SIZE
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
    //
    // This avoids copying large arrays every frame.
    // clone() creates a new Vec that wasm-bindgen converts to Float64Array.
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
    //
    // Use #[wasm_bindgen(getter)] for property-style access in JS:
    //   engine.current_value  (not engine.current_value())
    #[wasm_bindgen(getter)]
    pub fn current_value(&self) -> f64 {
        self.current_value
    }

    // --- WASM-side message parsing ---
    //
    // For high-frequency WebSocket feeds (50+ msg/sec), parsing JSON
    // in WASM can be faster than JS JSON.parse because:
    //   1. No JS object allocation (serde extracts only needed fields)
    //   2. One boundary crossing instead of N (parse + ingest in one call)
    //   3. No GC pressure from throwaway JS objects
    //
    // Trade-off: adds ~30KB for serde_json. Use framework's WasmIngestParser
    // to integrate with the WebSocketPipeline.
    //
    // Return bitmask: bit 0 = data updated, bit 1 = stats updated.
    //
    // Implement per data source:
    //
    // #[wasm_bindgen]
    // pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 {
    //     #[derive(Deserialize)]
    //     struct MyMsg { value: f64, timestamp: f64 }
    //
    //     let msg: MyMsg = match serde_json::from_str(raw) {
    //         Ok(m) => m,
    //         Err(_) => return 0,
    //     };
    //     self.add_data_point(msg.value, msg.timestamp, now_ms);
    //     1 // data updated
    // }
}

// ============================================
// STEP 5: Internal helpers (not exported to JS)
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
//     const priceFrame = priceEngine.tick(now);
//     const volumeFrame = volumeEngine.tick(now);
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
//         for i in 0..100 {
//             let frame = engine.tick(i as f64 * 16.67);
//             // smooth_value should approach 100.0
//         }
//         let frame = engine.tick(1667.0);
//         assert!((frame[F_VALUE_A] - 100.0).abs() < 1.0);
//     }
// }
