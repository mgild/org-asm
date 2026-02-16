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
// ============================================
// Auth engine interfaces
// ============================================

/**
 * IAuthEngine — Rust-owned authentication state contract.
 *
 * ALL auth state lives in the WASM engine: tokens, session lifecycle, RBAC
 * permissions/roles, user profile. TypeScript is a dumb UI renderer that
 * dispatches auth actions and reads state back via getSnapshot functions.
 *
 * State machine: Unauthenticated(0) → Authenticating(1) → Authenticated(2)
 * Refreshing(3) is entered when tokens need renewal. Error(4) on failures.
 *
 * Implementors: Rust structs compiled to WASM with token storage, permission
 * sets, and user profile JSON parsing.
 */
export interface IAuthEngine {
  // --- Token management ---
  /** Store access and refresh tokens with their expiry timestamps (ms). */
  set_tokens(access: string, refresh: string, access_expiry_ms: number, refresh_expiry_ms: number): void;
  /** Clear all tokens. */
  clear_tokens(): void;
  /** Get the current access token. */
  access_token(): string;
  /** Get the current refresh token. */
  refresh_token(): string;
  /** Whether the access token is expired at the given time. */
  is_token_expired(now_ms: number): boolean;
  /** Whether the refresh token is expired at the given time. */
  is_refresh_expired(now_ms: number): boolean;
  /** Get the Authorization header value (e.g. "Bearer <token>"). */
  token_header(): string;
  /** Access token expiry in ms since epoch. */
  access_expiry_ms(): number;
  /** Refresh token expiry in ms since epoch. */
  refresh_expiry_ms(): number;

  // --- State machine ---
  /** Current auth status as u8: 0=Unauthenticated, 1=Authenticating, 2=Authenticated, 3=Refreshing, 4=Error. */
  auth_status(): number;
  /** Transition to Authenticating state. */
  set_authenticating(): void;
  /** Transition to Authenticated state with tokens and user data. */
  set_authenticated(access: string, refresh: string, access_expiry_ms: number, refresh_expiry_ms: number, user_json: string): void;
  /** Transition to Error state with a message. */
  set_error(message: string): void;
  /** Transition to Refreshing state. */
  set_refreshing(): void;
  /** Get the current error message (empty if no error). */
  error_message(): string;

  // --- Session ---
  /** Clear all auth state (tokens, user, permissions, roles). */
  logout(): void;
  /** Whether the access token needs refreshing at the given time. */
  refresh_needed(now_ms: number): boolean;
  /** Whether the user is currently authenticated. */
  is_authenticated(): boolean;
  /** Session expiry timestamp in ms (the earlier of access/refresh expiry). */
  session_expires_at(): number;

  // --- RBAC ---
  /** Set permissions from a JSON array of strings. */
  set_permissions(json: string): void;
  /** Check if a permission is granted. */
  has_permission(name: string): boolean;
  /** Check if a role is granted. */
  has_role(role: string): boolean;
  /** Number of granted permissions. */
  permission_count(): number;
  /** Number of granted roles. */
  role_count(): number;
  /** Set roles from a JSON array of strings. */
  set_roles(json: string): void;
  /** Clear all permissions and roles. */
  clear_permissions(): void;

  // --- User ---
  /** Set user profile from JSON. Extracts id and display_name. */
  set_user(json: string): void;
  /** Get the user's ID. */
  user_id(): string;
  /** Get the user's display name. */
  user_display_name(): string;
  /** Get the raw user JSON. */
  user_json(): string;
  /** Clear user data. */
  clear_user(): void;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all auth state to defaults. */
  reset(): void;
}

// ============================================
// Router engine interfaces
// ============================================

/**
 * IRouterEngine — Rust-owned navigation state contract.
 *
 * ALL routing state lives in the WASM engine: current path, route matching,
 * params, query strings, history stack, guards, breadcrumbs. TypeScript is
 * a dumb renderer that dispatches navigation and reads route state back.
 *
 * Two-phase guard protocol: navigate() sets pending_guard if the route is
 * guarded and not pre-approved. TS reads pending_guard(), runs async checks,
 * then calls resolveGuard(true/false) to activate or revert.
 *
 * Implementors: Rust structs compiled to WASM with segment-based route
 * matching, Vec-based history stack, and HashMap guard results.
 */
export interface IRouterEngine {
  // --- Navigation ---
  /** Navigate to a path (push to history). */
  navigate(path: string): void;
  /** Replace the current path in history. */
  replace(path: string): void;
  /** Go back one entry in history. */
  back(): void;
  /** Go forward one entry in history. */
  forward(): void;

  // --- Current route ---
  /** Get the current path. */
  current_path(): string;
  /** Get the current matched route ID. */
  current_route_id(): string;
  /** Whether the given route ID matches the current route. */
  is_match(route_id: string): boolean;

  // --- Params ---
  /** Get a route parameter by name. */
  param(name: string): string;
  /** Number of route parameters. */
  param_count(): number;
  /** Get the name of a parameter by index. */
  param_name(index: number): string;

  // --- Query ---
  /** Get a query parameter by name. */
  query_param(name: string): string;
  /** Get the full query string. */
  query_string(): string;
  /** Set a query parameter. */
  set_query_param(name: string, value: string): void;
  /** Clear all query parameters. */
  clear_query_params(): void;
  /** Number of query parameters. */
  query_param_count(): number;
  /** Get the name of a query parameter by index. */
  query_param_name(index: number): string;

  // --- History ---
  /** Whether there is a previous entry in the history. */
  can_go_back(): boolean;
  /** Whether there is a next entry in the history. */
  can_go_forward(): boolean;
  /** Total number of entries in the history stack. */
  history_length(): number;
  /** Current index within the history stack. */
  history_index(): number;

  // --- Guards ---
  /** Get the pending guard route ID (empty if no guard pending). */
  pending_guard(): string;
  /** Resolve a pending guard (true = allow, false = deny). */
  resolve_guard(allowed: boolean): void;
  /** Pre-approve or deny a route guard result. */
  set_guard_result(route_id: string, allowed: boolean): void;
  /** Whether a route is allowed by its guard. */
  is_route_allowed(route_id: string): boolean;

  // --- Breadcrumbs ---
  /** Number of breadcrumb entries for the current route. */
  breadcrumb_count(): number;
  /** Label for a breadcrumb at the given index. */
  breadcrumb_label(index: number): string;
  /** Path for a breadcrumb at the given index. */
  breadcrumb_path(index: number): string;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all router state to defaults. */
  reset(): void;
}

// ============================================
// History (undo/redo) engine interfaces
// ============================================

/**
 * IHistoryEngine — Rust-owned undo/redo state contract.
 *
 * ALL history state lives in the WASM engine: undo/redo stacks, checkpoints,
 * capacity management. Commands are opaque JSON — the history engine doesn't
 * know HOW to undo; it stores commands and returns them when undo/redo is
 * called. TypeScript reads the returned JSON and applies reversal on the
 * target engine. This makes it composable with any engine.
 *
 * Implementors: Rust structs compiled to WASM with Vec-based undo/redo
 * stacks, checkpoint tracking, and capacity enforcement.
 */
export interface IHistoryEngine {
  // --- Push ---
  /** Push a command onto the undo stack (clears redo stack). */
  push_command(command_json: string): void;
  /** Push a batch of commands as a single undo entry. */
  push_batch(commands_json: string): void;

  // --- Undo/Redo ---
  /** Pop the last command from the undo stack, push to redo. Returns the command JSON. */
  undo(): string;
  /** Pop the last command from the redo stack, push to undo. Returns the command JSON. */
  redo(): string;
  /** Whether there are commands to undo. */
  can_undo(): boolean;
  /** Whether there are commands to redo. */
  can_redo(): boolean;

  // --- Stack info ---
  /** Number of commands in the undo stack. */
  undo_count(): number;
  /** Number of commands in the redo stack. */
  redo_count(): number;
  /** Label for an undo entry at the given index (0 = most recent). */
  undo_label(index: number): string;
  /** Label for a redo entry at the given index (0 = most recent). */
  redo_label(index: number): string;
  /** Get the last command that was pushed (without popping). */
  last_command(): string;

  // --- Capacity ---
  /** Maximum number of history entries. */
  max_history(): number;
  /** Set the maximum number of history entries. */
  set_max_history(max: number): void;

  // --- Checkpoints ---
  /** Mark the current state as a checkpoint (save point). */
  checkpoint(): void;
  /** Whether the current undo stack position is at a checkpoint. */
  is_at_checkpoint(): boolean;
  /** Whether there are changes since the last checkpoint. */
  has_unsaved_changes(): boolean;
  /** Number of commands since the last checkpoint. */
  commands_since_checkpoint(): number;

  // --- Clear ---
  /** Clear the entire undo stack. */
  clear_history(): void;
  /** Clear only the redo stack. */
  clear_redo(): void;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all history state to defaults. */
  reset(): void;
}

// ============================================
// Table engine interfaces
// ============================================

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

// ============================================
// Intl (i18n) engine interfaces
// ============================================

/**
 * IIntlEngine — Rust-owned internationalization state contract.
 *
 * ALL locale/translation state lives in the WASM engine: current locale,
 * fallback locale, message catalogs, missing key tracking, pluralization.
 * TypeScript is a dumb text renderer that dispatches locale changes and
 * reads translated strings back via getSnapshot functions.
 *
 * Fallback chain: current locale → fallback locale → return key as-is.
 * Pluralization: count==0 → key.zero (→ key.other), count==1 → key.one, else → key.other.
 *
 * Implementors: Rust structs compiled to WASM with HashMap-based catalogs
 * and per-key missing tracking.
 */
export interface IIntlEngine {
  // --- Locale ---
  /** Set the active locale. */
  set_locale(locale: string): void;
  /** Get the current active locale. */
  current_locale(): string;
  /** Number of available locales. */
  available_locales_count(): number;
  /** Get an available locale by index. */
  available_locale(index: number): string;
  /** Add a locale to the available set. */
  add_locale(locale: string): void;

  // --- Catalog ---
  /** Load messages for a locale from flat JSON {"key":"value"}. */
  load_messages(locale: string, json: string): void;
  /** Clear all messages for a locale. */
  clear_messages(locale: string): void;

  // --- Translation ---
  /** Translate a key. Returns the key itself if missing. */
  translate(key: string): string;
  /** Translate with parameter interpolation. params_json is {"param":"value"}. */
  translate_with_params(key: string, params_json: string): string;
  /** Translate with pluralization. Resolves key.zero/key.one/key.other based on count. */
  translate_plural(key: string, count: number): string;

  // --- Missing keys ---
  /** Number of missing keys encountered. */
  missing_key_count(): number;
  /** Get a missing key by index. */
  missing_key(index: number): string;

  // --- Fallback ---
  /** Set the fallback locale. */
  set_fallback_locale(locale: string): void;
  /** Get the fallback locale. */
  fallback_locale(): string;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all intl state to defaults. */
  reset(): void;
}

// ============================================
// Search/Filter engine interfaces
// ============================================

/**
 * ISearchEngine — Rust-owned search/filter state contract.
 *
 * ALL search state lives in the WASM engine: items, query, filters, sort,
 * pagination, facets. TypeScript is a dumb result renderer that dispatches
 * search actions and reads results back.
 *
 * Lazy recomputation: mutations set a dirty flag, reads trigger recompute()
 * if dirty. This avoids redundant computation when multiple mutations happen
 * before a read.
 *
 * Implementors: Rust structs compiled to WASM with Vec-based item storage,
 * filter evaluation, and on-the-fly facet computation.
 */
export interface ISearchEngine {
  // --- Data ---
  /** Load items from a JSON array of objects. */
  load_items(json: string): void;
  /** Clear all items. */
  clear_items(): void;
  /** Total number of loaded items. */
  item_count(): number;
  /** Number of items matching current query/filters. */
  result_count(): number;

  // --- Search ---
  /** Set the search query text. */
  set_query(text: string): void;
  /** Get the current search query. */
  current_query(): string;
  /** Set which fields to search. JSON array of field names. */
  set_search_fields(json: string): void;

  // --- Filters ---
  /** Add a filter. Op: 0=Eq,1=NotEq,2=Gt,3=Lt,4=Gte,5=Lte,6=Contains,7=StartsWith,8=In. */
  add_filter(field: string, op: number, value: string): void;
  /** Remove a filter by index. */
  remove_filter(index: number): void;
  /** Clear all filters. */
  clear_filters(): void;
  /** Number of active filters. */
  filter_count(): number;
  /** Get the field name of a filter by index. */
  filter_field(index: number): string;
  /** Get the operator of a filter by index. */
  filter_op(index: number): number;
  /** Get the value of a filter by index. */
  filter_value(index: number): string;

  // --- Sort ---
  /** Set sort field and direction (0=none, 1=asc, 2=desc). */
  set_sort(field: string, direction: number): void;
  /** Clear sort. */
  clear_sort(): void;
  /** Current sort field. */
  sort_field(): string;
  /** Current sort direction. */
  sort_direction(): number;

  // --- Results (paginated) ---
  /** Get the ID of a result at index (within current page). */
  result_id(index: number): string;
  /** Get a field value of a result at index (within current page). */
  result_value(index: number, field: string): string;

  // --- Pagination ---
  /** Set the current page (0-based). */
  set_page(page: number): void;
  /** Set the page size. */
  set_page_size(size: number): void;
  /** Current page index. */
  page(): number;
  /** Current page size. */
  page_size(): number;
  /** Total number of pages. */
  page_count(): number;

  // --- Facets ---
  /** Number of distinct values for a field across results. */
  facet_count(field: string): number;
  /** Get a facet value by field and index. */
  facet_value(field: string, index: number): string;
  /** Number of items matching a specific facet value. */
  facet_item_count(field: string, value: string): number;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all search state to defaults. */
  reset(): void;
}

// ============================================
// State machine engine interfaces
// ============================================

/**
 * IStateMachineEngine — Rust-owned generic state machine contract.
 *
 * ALL FSM state lives in the WASM engine: states, transitions, guards,
 * active states, history, context. TypeScript is a dumb state renderer
 * that dispatches events and reads state back.
 *
 * Two-phase guard protocol (same as router): send_event() stashes pending
 * if guarded, resolve_guard() completes or cancels.
 *
 * Supports parallel state charts via multiple active states.
 *
 * Implementors: Rust structs compiled to WASM with HashMap-based states,
 * Vec-based transitions, and two-phase guard resolution.
 */
export interface IStateMachineEngine {
  // --- Config ---
  /** Add a state. json is {label, meta}. */
  add_state(id: string, json: string): void;
  /** Add a transition from one state to another on an event. */
  add_transition(from_state: string, event: string, to_state: string): void;
  /** Set the initial state. */
  set_initial_state(id: string): void;
  /** Set a guard on a transition (from_state + event). */
  set_guard(from_state: string, event: string, guard_id: string): void;

  // --- State ---
  /** Get the current state ID. */
  current_state(): string;
  /** Get the current state label. */
  current_state_label(): string;
  /** Get the current state meta JSON. */
  current_state_meta(): string;

  // --- Transitions ---
  /** Send an event. Returns true if transition occurred (or guard pending). */
  send_event(event: string): boolean;
  /** Whether an event can be sent from the current state. */
  can_send(event: string): boolean;
  /** Number of available events from the current state. */
  available_event_count(): number;
  /** Get an available event by index. */
  available_event(index: number): string;

  // --- Guards ---
  /** Get the pending guard ID (empty if none). */
  pending_guard(): string;
  /** Resolve a pending guard (true = allow, false = deny). */
  resolve_guard(allowed: boolean): void;
  /** Get the guard ID for the pending transition. */
  guard_id(): string;

  // --- History ---
  /** Get the previous state ID. */
  previous_state(): string;
  /** Total number of transitions that have occurred. */
  transition_count(): number;
  /** Number of states in the history. */
  state_history_count(): number;
  /** Get a state from history by index. */
  state_history(index: number): string;

  // --- Context ---
  /** Set context from JSON. */
  set_context(json: string): void;
  /** Get context as JSON. */
  context_json(): string;
  /** Merge JSON into existing context. */
  merge_context(json: string): void;

  // --- Parallel ---
  /** Number of active states (1 for flat FSM, >1 for parallel). */
  active_state_count(): number;
  /** Get an active state by index. */
  active_state(index: number): string;
  /** Whether a specific state is currently active. */
  is_in_state(id: string): boolean;

  // --- Actions ---
  /** Get the on-enter action descriptor JSON for a state. */
  on_enter_action(state_id: string): string;
  /** Get the on-exit action descriptor JSON for a state. */
  on_exit_action(state_id: string): string;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all state machine state to defaults. */
  reset(): void;
}

// ============================================
// API engine interfaces
// ============================================

/**
 * IApiEngine — Rust-owned API request state contract.
 *
 * ALL API state lives in the WASM engine: endpoints, requests, responses,
 * cache, format config. TypeScript is a dumb request executor that
 * dispatches API actions and reads request state back.
 *
 * One-platform style: caller passes ONE params object, engine splits by
 * source (query/body/path/header) based on endpoint param definitions.
 * build_url() does path param substitution + query param append.
 * build_body() extracts body-sourced params as JSON.
 *
 * Supports JSON and FlatBuffer response formats with zero-copy ptr/len
 * accessors for FlatBuffer responses.
 *
 * Implementors: Rust structs compiled to WASM with Vec-based endpoint
 * storage, request tracking, and HashMap-based response cache.
 */
export interface IApiEngine {
  // --- Endpoints ---
  /** Register an endpoint. params_json defines [{name, source, required}]. */
  register_endpoint(id: string, method: string, path: string, params_json: string): void;

  // --- Requests ---
  /** Begin a request. Returns a request ID. */
  begin_request(endpoint_id: string, params_json: string): number;
  /** Mark a request as loading. */
  set_request_loading(request_id: number): void;
  /** Mark a request as successful with response data. */
  set_request_success(request_id: number, response_json: string): void;
  /** Mark a request as failed with an error message. */
  set_request_error(request_id: number, error: string): void;
  /** Cancel a request. */
  cancel_request(request_id: number): void;

  // --- Responses ---
  /** Get the response JSON for a request. */
  response_json(request_id: number): string;
  /** Get the response status for a request. */
  response_status(request_id: number): number;
  /** Get the response error for a request. */
  response_error(request_id: number): string;

  // --- Format ---
  /** Set the response format for an endpoint ("json" or "flatbuffer"). */
  set_format(endpoint_id: string, format: number): void;
  /** Get the response format for an endpoint. */
  endpoint_format(endpoint_id: string): number;

  // --- FlatBuffer zero-copy ---
  /** Get the pointer to FlatBuffer response data. */
  response_ptr(request_id: number): number;
  /** Get the length of FlatBuffer response data. */
  response_len(request_id: number): number;

  // --- Param normalization ---
  /** Build URL with path param substitution + query params. */
  build_url(endpoint_id: string, params_json: string): string;
  /** Build request body from body-sourced params. */
  build_body(endpoint_id: string, params_json: string): string;

  // --- Cache ---
  /** Set cache TTL for an endpoint in milliseconds. */
  set_cache_ttl(endpoint_id: string, ttl_ms: number): void;
  /** Whether a cached response exists for the given endpoint + params. */
  is_cached(endpoint_id: string, params_json: string): boolean;
  /** Get a cached response. */
  cached_response(endpoint_id: string, params_json: string): string;
  /** Invalidate cache for a specific endpoint. */
  invalidate_cache(endpoint_id: string): void;
  /** Invalidate all cached responses. */
  invalidate_all_cache(): void;

  // --- Info ---
  /** Number of active (non-completed) requests. */
  active_request_count(): number;
  /** Get the state of a request as u8. */
  request_state(request_id: number): number;
  /** Number of registered endpoints. */
  endpoint_count(): number;
  /** Get an endpoint ID by index. */
  endpoint_id(index: number): string;
  /** Get the HTTP method of an endpoint. */
  endpoint_method(id: string): string;
  /** Get the path pattern of an endpoint. */
  endpoint_path(id: string): string;

  // --- Standard ---
  /** Monotonically increasing version — bumped on every state change. */
  data_version(): number;
  /** Reset all API state to defaults. */
  reset(): void;
}
