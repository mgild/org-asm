import type {
  TimeSeriesData,
  FrameBufferSchema,
  CSSEffect,
  DataResult,
  FieldExtractor,
  BoolExtractor,
} from './types';

/**
 * IEngine<F> — The Model contract.
 *
 * WASM engine that owns all state and computation. The engine is the single
 * source of truth: no JS-side state duplication. One tick() call per animation
 * frame returns a frame of type F containing everything the View needs to
 * render the current state.
 *
 * F can be any frame representation: Float64Array, a FlatBuffer table,
 * a plain object, etc. The choice of F determines how consumers read values
 * (via extractors or direct property access).
 *
 * Implementors: Rust structs compiled to WASM that expose these methods
 * via wasm-bindgen.
 */
export interface IEngine<F = Float64Array> {
  /** Compute a full animation frame. Returns frame of type F. */
  tick(nowMs: number): F;

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
 * IAnimationLoop<F> — Orchestrates the render cycle.
 *
 * Each frame: calls engine.tick(), then distributes the resulting frame
 * to all registered consumers in priority order. Consumers do their own
 * interpretation (DOM mutations, canvas draws, store updates).
 */
export interface IAnimationLoop<F = Float64Array> {
  start(): void;
  stop(): void;
  readonly running: boolean;

  /** Register a frame consumer */
  addConsumer(consumer: IFrameConsumer<F>): void;
  removeConsumer(consumer: IFrameConsumer<F>): void;
}

/**
 * IFrameConsumer<F> — Receives frame data each animation tick.
 *
 * Implement this for each piece of the View that needs per-frame updates.
 * Keep onFrame() fast: no allocations, no DOM reads, minimal branching.
 * Heavy work should be done in the WASM engine, not here.
 */
export interface IFrameConsumer<F = Float64Array> {
  /** Process a new frame. Called at 60fps. Must be fast. */
  onFrame(frame: F, nowMs: number): void;

  /** Priority for ordering (lower = earlier). Default 0. */
  readonly priority: number;
}

/**
 * IChartRenderer<F> — Specialized frame consumer for chart libraries.
 *
 * Wraps chart libraries (uPlot, lightweight-charts, etc.) behind a stable
 * contract. The animation loop feeds it frame data; it decides when to
 * actually repaint the chart (typically on data version changes, not every frame).
 */
export interface IChartRenderer<F = Float64Array> extends IFrameConsumer<F> {
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
 * IEffectApplicator<F> — Applies frame values to DOM elements.
 *
 * Maps frame extractors to CSS properties and style mutations.
 * Bind DOM elements by name, then each frame the applicator reads
 * the relevant values via extractors and writes CSS properties / inline styles.
 * This is the "thin rendering layer" — no logic, just value application.
 */
export interface IEffectApplicator<F = Float64Array> extends IFrameConsumer<F> {
  /** Bind a DOM element for effect application */
  bind(name: string, element: HTMLElement): void;

  /** Unbind a DOM element */
  unbind(name: string): void;

  /** Get computed CSS effects from current frame */
  getCSSEffects(frame: F): CSSEffect[];
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

/**
 * IWasmBinaryIngestEngine — Engine that receives pre-serialized binary frames.
 *
 * Used on the client side to receive FlatBuffer frames from a server engine
 * over binary WebSocket. The server serializes once; the client deserializes
 * and updates its state. No JSON parsing, no field extraction — just raw bytes.
 *
 * Pair with `BinaryFrameParser` from the controller to wire into WebSocketPipeline.
 *
 * Implementation in Rust:
 *   #[wasm_bindgen]
 *   pub fn ingest_frame(&mut self, bytes: &[u8]) {
 *       let frame = flatbuffers::root::<OrderbookFrame>(bytes).unwrap();
 *       self.best_bid = frame.best_bid();
 *       self.data_version += 1;
 *   }
 */
export interface IWasmBinaryIngestEngine {
  ingest_frame(bytes: Uint8Array): void;
}

// ============================================
// Form engine interfaces
// ============================================

/**
 * IFormEngine — Rust-owned form state contract.
 *
 * ALL form state lives in the WASM engine: field values, errors, touched/dirty
 * tracking, validation, submission lifecycle. TypeScript is a dumb input renderer
 * that calls set_field/touch_field and reads back state via getSnapshot functions.
 *
 * Implementors: Rust structs compiled to WASM that use HashMap-based field storage
 * with per-field validation dispatched by field name.
 */
export interface IFormEngine {
  /** Set a field value. Triggers validation and dirty tracking. */
  set_field(name: string, value: string): void;
  /** Mark a field as touched (blurred). */
  touch_field(name: string): void;
  /** Read the current value of a field. */
  field_value(name: string): string;
  /** Read the validation error for a field. Empty string = valid. */
  field_error(name: string): string;
  /** Whether a field has been touched (blurred). */
  field_touched(name: string): boolean;
  /** Whether a field value differs from its initial value. */
  field_dirty(name: string): boolean;
  /** Whether ALL fields pass validation. */
  is_valid(): boolean;
  /** Whether ANY field is dirty. */
  is_dirty(): boolean;
  /** Whether the form can be submitted (valid + dirty, or valid + never submitted). */
  can_submit(): boolean;
  /** Whether submit() has been called at least once. */
  has_been_submitted(): boolean;
  /** Touch all fields, validate all, set submitted flag. Returns is_valid(). */
  submit(): boolean;
  /** Reset all fields to initial values, clear touched/dirty/submitted. */
  reset(): void;
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
}

/**
 * IWizardFormEngine — Multi-step form (wizard) extension.
 *
 * Adds step navigation on top of IFormEngine. Validation can be scoped
 * to the current step so users can advance without filling future steps.
 */
export interface IWizardFormEngine extends IFormEngine {
  /** Current step index (0-based). */
  step(): number;
  /** Total number of steps. */
  step_count(): number;
  /** Whether the current step's fields are valid and advance is allowed. */
  can_advance(): boolean;
  /** Whether there is a previous step. */
  can_go_back(): boolean;
  /** Validate current step, advance if valid. Returns success. */
  advance(): boolean;
  /** Go to the previous step. Returns success. */
  go_back(): boolean;
}

// ============================================
// Table engine interfaces
// ============================================

/**
 * ITableEngine — Rust-owned data table state contract.
 *
 * ALL table state lives in the WASM engine: sorting, filtering, pagination,
 * row selection, cell editing, grouping/aggregation. TypeScript is a dumb
 * row renderer that dispatches user actions and reads state back.
 *
 * Two-phase fetch protocol: When sort/filter/page changes, the engine sets
 * needs_fetch=true and exposes query_descriptor() JSON. TypeScript reads it,
 * fetches from server, calls ingest_page(bytes, total_rows). Engine sets
 * needs_fetch=false.
 *
 * Implementors: Rust structs compiled to WASM with HashMap-based column
 * storage, FlatBuffer page data, and per-cell edit overlay.
 */
export interface ITableEngine {
  // --- Page data (FlatBuffer zero-copy) ---
  /** Pointer to FlatBuffer bytes in WASM memory. */
  page_ptr(): number;
  /** Byte length of the current page data. */
  page_len(): number;
  /** Number of rows in the current page. */
  row_count(): number;
  /** Total rows across all pages (from server). */
  total_row_count(): number;

  // --- Ingest ---
  /** Ingest a page of FlatBuffer data from the server. */
  ingest_page(bytes: Uint8Array, total_rows: number): void;

  // --- Pagination ---
  /** Current page index (0-based). */
  page(): number;
  /** Rows per page. */
  page_size(): number;
  /** Total number of pages. */
  page_count(): number;
  /** Navigate to a specific page. Sets needs_fetch=true. */
  set_page(page: number): void;
  /** Change page size. Resets to page 0. Sets needs_fetch=true. */
  set_page_size(size: number): void;

  // --- Sort ---
  /** Current sort column. Empty string = no sort. */
  sort_column(): string;
  /** Current sort direction: 0=none, 1=asc, 2=desc. */
  sort_direction(): number;
  /** Set sort column and direction. Sets needs_fetch=true. */
  set_sort(column: string, direction: number): void;
  /** Cycle sort: none → asc → desc → none. Sets needs_fetch=true. */
  toggle_sort(column: string): void;

  // --- Filter ---
  /** Get filter value for a column. Empty string = no filter. */
  filter_value(column: string): string;
  /** Set filter value for a column. Resets to page 0. Sets needs_fetch=true. */
  set_filter(column: string, value: string): void;
  /** Clear all filters. Resets to page 0. Sets needs_fetch=true. */
  clear_filters(): void;

  // --- Selection ---
  /** Whether a row is selected by index. */
  is_row_selected(row_index: number): boolean;
  /** Select a row by index. */
  select_row(row_index: number): void;
  /** Deselect a row by index. */
  deselect_row(row_index: number): void;
  /** Toggle a row's selection. */
  toggle_row(row_index: number): void;
  /** Select all rows on the current page. */
  select_all(): void;
  /** Deselect all rows. */
  deselect_all(): void;
  /** Number of currently selected rows. */
  selected_count(): number;
  /** Whether all rows on the current page are selected. */
  all_selected(): boolean;

  // --- Cell editing ---
  /** Whether the table supports editing. */
  is_editable(): boolean;
  /** Get the edit overlay value (or original) for a cell. */
  edit_value(row_index: number, column: string): string;
  /** Set an edit value for a cell. */
  set_edit_value(row_index: number, column: string, value: string): void;
  /** Get the validation error for a cell. Empty string = valid. */
  cell_error(row_index: number, column: string): string;
  /** Whether a cell has been edited (differs from original). */
  is_cell_dirty(row_index: number, column: string): boolean;
  /** Whether any cells have pending edits. */
  has_edits(): boolean;
  /** Commit all dirty edits. Returns JSON of changed cells. */
  commit_edits(): string;
  /** Discard all pending edits. */
  discard_edits(): void;

  // --- Grouping / Aggregation ---
  /** Current group-by column. Empty string = not grouped. */
  group_by_column(): string;
  /** Set the group-by column. Sets needs_fetch=true. */
  set_group_by(column: string): void;
  /** Clear grouping. Sets needs_fetch=true. */
  clear_group_by(): void;
  /** Number of groups in the current page. */
  group_count(): number;
  /** Label for a group by index. */
  group_label(group_index: number): string;
  /** Aggregation JSON for a group by index. */
  group_row_count(group_index: number): string;
  /** Whether a group is expanded. */
  is_group_expanded(group_index: number): boolean;
  /** Toggle a group's expanded state. */
  toggle_group(group_index: number): void;

  // --- Query descriptor ---
  /** Whether the table needs to fetch new data from the server. */
  needs_fetch(): boolean;
  /** Acknowledge that a fetch has been initiated. */
  acknowledge_fetch(): void;
  /** JSON descriptor of the current query state. */
  query_descriptor(): string;

  // --- State ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all state to defaults. */
  reset(): void;
}
