import type {
  TimeSeriesData,
  FrameBufferSchema,
  CSSEffect,
  DataResult,
} from './types';

/**
 * IEngine — The Model contract.
 *
 * WASM engine that owns all state and computation. The engine is the single
 * source of truth: no JS-side state duplication. One tick() call per animation
 * frame returns a flat Float64Array containing everything the View needs to
 * render the current state.
 *
 * Implementors: Rust structs compiled to WASM that expose these methods
 * via wasm-bindgen. The flat f64 return avoids serde overhead on every frame.
 */
export interface IEngine {
  /** Compute a full animation frame. Returns flat f64 array. */
  tick(nowMs: number): Float64Array;

  /** Get current time-series data for chart rendering */
  getTimeSeriesData(): TimeSeriesData;

  /** Process incoming real-time data point */
  addDataPoint(value: number, timestamp: number, nowMs: number): void;

  /** Update engine configuration at runtime */
  configure(key: string, value: number): void;

  /** Start an action/session */
  openAction(params: Record<string, unknown>, nowMs: number): void;

  /** End an action/session, returns result value (e.g. score, delta) */
  closeAction(nowMs: number): number;

  /** Load historical data for initialization */
  loadHistory(timestamps: Float64Array, values: Float64Array): void;

  /** Get the frame buffer schema for this engine */
  readonly schema: FrameBufferSchema;
}

/**
 * IAnimationLoop — Orchestrates the render cycle.
 *
 * Each frame: calls engine.tick(), then distributes the resulting Float64Array
 * to all registered consumers in priority order. Consumers do their own
 * interpretation (DOM mutations, canvas draws, store updates).
 */
export interface IAnimationLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;

  /** Register a frame consumer */
  addConsumer(consumer: IFrameConsumer): void;
  removeConsumer(consumer: IFrameConsumer): void;
}

/**
 * IFrameConsumer — Receives frame data each animation tick.
 *
 * Implement this for each piece of the View that needs per-frame updates.
 * Keep onFrame() fast: no allocations, no DOM reads, minimal branching.
 * Heavy work should be done in the WASM engine, not here.
 */
export interface IFrameConsumer {
  /** Process a new frame. Called at 60fps. Must be fast. */
  onFrame(frame: Float64Array, nowMs: number): void;

  /** Priority for ordering (lower = earlier). Default 0. */
  readonly priority: number;
}

/**
 * IChartRenderer — Specialized frame consumer for chart libraries.
 *
 * Wraps chart libraries (uPlot, lightweight-charts, etc.) behind a stable
 * contract. The animation loop feeds it frame data; it decides when to
 * actually repaint the chart (typically on data version changes, not every frame).
 */
export interface IChartRenderer extends IFrameConsumer {
  /** Set chart data. Only called when data version changes. */
  setData(data: TimeSeriesData): void;

  /** Set visible time window */
  setTimeWindow(minSec: number, maxSec: number): void;

  /** Resize chart to container */
  resize(width: number, height: number): void;

  /** Destroy chart and release resources */
  destroy(): void;
}

/**
 * IEffectApplicator — Applies frame values to DOM elements.
 *
 * Maps frame buffer offsets to CSS properties and style mutations.
 * Bind DOM elements by name, then each frame the applicator reads
 * the relevant offsets and writes CSS properties / inline styles.
 * This is the "thin rendering layer" — no logic, just value application.
 */
export interface IEffectApplicator extends IFrameConsumer {
  /** Bind a DOM element for effect application */
  bind(name: string, element: HTMLElement): void;

  /** Unbind a DOM element */
  unbind(name: string): void;

  /** Get computed CSS effects from current frame */
  getCSSEffects(frame: Float64Array): CSSEffect[];
}

/**
 * IDataPipeline — Controller for real-time data flow.
 *
 * Manages the connection between external data sources (WebSocket, SSE, etc.)
 * and the engine. Parses incoming messages and feeds them to the engine.
 * Throttles store updates to avoid React re-render storms.
 */
export interface IDataPipeline {
  /** Connect to data source */
  connect(url: string): void;

  /** Disconnect from data source */
  disconnect(): void;

  /** Register message parser */
  setParser(parser: IMessageParser): void;

  readonly connected: boolean;
}

/**
 * IMessageParser — Parses raw WebSocket messages into engine calls.
 *
 * Implement per data source. The parser extracts values and calls
 * engine.addDataPoint() or other methods. Returns a DataResult indicating
 * what changed so consumers can react accordingly.
 */
export interface IMessageParser {
  /** Parse raw message string. Returns true if data was extracted. */
  parse(raw: string, engine: IEngine, nowMs: number): DataResult;
}

/**
 * IStore — Minimal reactive store contract.
 *
 * Zustand-compatible but framework-agnostic. The framework never imports
 * Zustand directly; it codes against this interface. This allows swapping
 * store implementations (Zustand, Jotai, vanilla) without touching framework code.
 */
export interface IStore<T> {
  getState(): T;
  setState(partial: Partial<T>): void;
  subscribe(listener: (state: T) => void): () => void;
}

/**
 * IThrottledEmitter — Emits values at a throttled rate.
 *
 * Used to bridge 60fps frame data to React's ~16ms render budget.
 * The emitter accumulates values and only fires subscribers at the
 * configured throttle interval, preventing React re-render storms.
 */
export interface IThrottledEmitter<T> {
  emit(value: T): void;
  subscribe(handler: (value: T) => void): () => void;
  readonly throttleMs: number;
}

// ============================================
// Zero-copy WASM interfaces
// ============================================

/**
 * IZeroCopyEngine — Engine with persistent frame buffer in WASM linear memory.
 *
 * Instead of returning Vec<f64> from tick() (which wasm-bindgen copies into a
 * new JS Float64Array), the engine writes into a persistent internal buffer.
 * JS creates a Float64Array VIEW directly into WASM memory — zero allocation,
 * zero copy. Use with zeroCopyTickAdapter() from WasmBridge.
 *
 * The view must be recreated each frame because memory.buffer can change
 * after WASM memory growth. Creating a Float64Array view is cheap (~10ns).
 */
export interface IZeroCopyEngine {
  tick(nowMs: number): void;
  frame_ptr(): number;
  frame_len(): number;
}

/**
 * IZeroCopyDataSource — Engine exposing time-series data via pointers.
 *
 * Instead of cloning Vec<f64> via get_timestamps()/get_values() (O(n) copy),
 * exposes raw pointers + lengths so JS can create Float64Array views into
 * WASM linear memory. Use with ChartDataConsumer.zeroCopy().
 *
 * Views must be recreated after any operation that might cause WASM memory
 * growth (e.g., add_data_point pushing to a Vec).
 */
export interface IZeroCopyDataSource {
  data_version(): number;
  timestamps_ptr(): number;
  timestamps_len(): number;
  values_ptr(): number;
  values_len(): number;
}

/**
 * IWasmIngestEngine — Engine that parses messages internally in WASM.
 *
 * Instead of JSON.parse in JS → extract fields → multiple WASM calls,
 * the raw message string goes directly to WASM where serde_json parses it.
 * One boundary crossing instead of many. Eliminates JS object allocation.
 *
 * Return value is a bitmask:
 *   bit 0 (INGEST_DATA_UPDATED = 1): new trade/price data
 *   bit 1 (INGEST_STATS_UPDATED = 2): ticker/metadata update
 *
 * Trade-off: adds ~30KB for serde_json. Worth it at 50+ messages/sec.
 */
export interface IWasmIngestEngine {
  ingest_message(raw: string, nowMs: number): number;
}
