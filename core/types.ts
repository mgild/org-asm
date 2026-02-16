/**
 * Core types for the WASM Engine Framework.
 * All real-time WASM+React apps built on this framework share these contracts.
 *
 * Design principle: The framework is generic over frame type <F>. Consumers use
 * extractor functions (frame: F) => number instead of magic offset numbers.
 * This works with any frame representation: FlatBuffers, Float64Array, plain
 * objects, DataView, etc.
 *
 * The Float64Array path (FrameBufferFactory + offsets) is still fully supported
 * for backward compatibility and simplicity.
 */

// ============================================
// Generic extractor types
// ============================================

/** Extracts a numeric value from a frame of type F */
export type FieldExtractor<F> = (frame: F) => number;

/** Extracts a boolean value from a frame of type F */
export type BoolExtractor<F> = (frame: F) => boolean;

// ============================================
// Float64Array-specific types (backward compat)
// ============================================

/** Frame buffer field descriptor — maps named fields to flat array offsets */
export interface FrameFieldDescriptor {
  readonly name: string;
  readonly offset: number;
  readonly type: 'f64' | 'bool' | 'u8'; // bool = 0.0/1.0, u8 = 0-255 stored as f64
}

/** Schema defining all fields in a frame buffer */
export interface FrameBufferSchema {
  readonly fields: readonly FrameFieldDescriptor[];
  readonly size: number;
}

/** Type-safe frame buffer accessor generated from a schema */
export type FrameAccessor<S extends Record<string, number>> = {
  readonly raw: Float64Array;
  get(field: keyof S): number;
  getBool(field: keyof S): boolean;
  getU8(field: keyof S): number;
};

/** Time-series data pair for chart rendering */
export interface TimeSeriesData {
  readonly timestamps: ArrayLike<number>;
  readonly values: ArrayLike<number>;
  readonly version: number;
}

/** Result of processing an incoming data message */
export interface DataResult {
  readonly dataUpdated: boolean;
  readonly statsUpdated: boolean;
}

/** CSS custom property mutation — batched for efficient DOM writes */
export interface CSSEffect {
  readonly property: string;
  readonly value: string;
}

// ============================================
// Zero-copy WASM memory types
// ============================================

/**
 * Bitmask constants for IWasmIngestEngine.ingest_message() return values.
 * Engines return a combination of these flags to indicate what changed.
 */
export const INGEST_DATA_UPDATED = 1;
export const INGEST_STATS_UPDATED = 2;

// ============================================
// Connection state types
// ============================================

/** WebSocket connection state machine states */
export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
}

// ============================================
// WASM Result type
// ============================================

/** Successful WASM call result */
export interface WasmOk<T> {
  readonly ok: true;
  readonly value: T;
}

/** Failed WASM call result */
export interface WasmErr {
  readonly ok: false;
  readonly error: string;
}

/** Structured result from fallible WASM methods. Mirrors Rust's Result<T, E>. */
export type WasmResult<T> = WasmOk<T> | WasmErr;

// ============================================
// Connection state types
// ============================================

/** Structured connection error surfaced via onError handler */
export interface ConnectionError {
  readonly type: 'connect_failed' | 'connection_lost' | 'max_retries_exhausted';
  readonly message: string;
  readonly attempt: number;
  readonly timestamp: number;
}

// ============================================
// Form engine types
// ============================================

/** Per-field state snapshot. Read by useFormField. */
export interface FieldState {
  readonly value: string;
  readonly error: string;
  readonly touched: boolean;
  readonly dirty: boolean;
  /** (touched || submitted) && error !== '' */
  readonly showError: boolean;
}

/** Top-level form state snapshot. Read by useFormState. */
export interface FormState {
  readonly isValid: boolean;
  readonly isDirty: boolean;
  readonly canSubmit: boolean;
  readonly hasBeenSubmitted: boolean;
  readonly dataVersion: number;
}

// ============================================
// Table engine types
// ============================================

/** Sort direction for table columns. */
export enum SortDirection { None = 0, Asc = 1, Desc = 2 }

/** Per-row state snapshot. Read by useTableRow. */
export interface RowState {
  readonly rowIndex: number;
  readonly selected: boolean;
}

/** Per-cell state snapshot. Read by useTableCell. */
export interface CellState {
  readonly value: string;
  readonly error: string;
  readonly dirty: boolean;
}

/** Top-level table state snapshot. Read by useTableState. */
export interface TableState {
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly totalRowCount: number;
  readonly rowCount: number;
  readonly sortColumn: string;
  readonly sortDirection: SortDirection;
  readonly selectedCount: number;
  readonly allSelected: boolean;
  readonly hasEdits: boolean;
  readonly isEditable: boolean;
  readonly needsFetch: boolean;
  readonly groupByColumn: string;
  readonly groupCount: number;
  readonly dataVersion: number;
}

// ============================================
// Auth engine types
// ============================================

/** Auth status enum. Mirrors the u8 values from the Rust engine. */
export enum AuthStatus {
  Unauthenticated = 0,
  Authenticating = 1,
  Authenticated = 2,
  Refreshing = 3,
  Error = 4,
}

/** Top-level auth state snapshot. Read by useAuthState. */
export interface AuthState {
  readonly status: AuthStatus;
  readonly isAuthenticated: boolean;
  readonly errorMessage: string;
  readonly accessExpiryMs: number;
  readonly refreshExpiryMs: number;
  readonly userId: string;
  readonly userDisplayName: string;
  readonly permissionCount: number;
  readonly roleCount: number;
  readonly dataVersion: number;
}

/** Per-permission state snapshot. Read by usePermission. */
export interface PermissionState {
  readonly name: string;
  readonly granted: boolean;
}

/** Per-role state snapshot. Read by useRole. */
export interface RoleState {
  readonly role: string;
  readonly granted: boolean;
}

// ============================================
// Router engine types
// ============================================

/** Top-level route state snapshot. Read by useRoute. */
export interface RouteState {
  readonly path: string;
  readonly routeId: string;
  readonly queryString: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly historyLength: number;
  readonly historyIndex: number;
  readonly pendingGuard: string;
  readonly dataVersion: number;
}

/** Per-route match state snapshot. Read by useRouteMatch. */
export interface RouteMatch {
  readonly routeId: string;
  readonly isMatch: boolean;
  readonly isAllowed: boolean;
}

/** Breadcrumb item for navigation trails. */
export interface BreadcrumbItem {
  readonly label: string;
  readonly path: string;
}

// ============================================
// History engine types
// ============================================

/** Top-level history state snapshot. Read by useHistoryState. */
export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoCount: number;
  readonly redoCount: number;
  readonly isAtCheckpoint: boolean;
  readonly hasUnsavedChanges: boolean;
  readonly commandsSinceCheckpoint: number;
  readonly maxHistory: number;
  readonly dataVersion: number;
}

/** Command entry for undo/redo stack display. */
export interface CommandEntry {
  readonly index: number;
  readonly label: string;
}

// ============================================
// Intl (i18n) engine types
// ============================================

/** Top-level intl state snapshot. Read by useIntlState. */
export interface IntlState {
  readonly locale: string;
  readonly fallbackLocale: string;
  readonly availableLocaleCount: number;
  readonly missingKeyCount: number;
  readonly dataVersion: number;
}

/** Per-key translation state snapshot. Read by useTranslation. */
export interface TranslationState {
  readonly key: string;
  readonly value: string;
  readonly missing: boolean;
}

// ============================================
// Search/Filter engine types
// ============================================

/** Filter comparison operator. */
export enum FilterOp {
  Eq = 0,
  NotEq = 1,
  Gt = 2,
  Lt = 3,
  Gte = 4,
  Lte = 5,
  Contains = 6,
  StartsWith = 7,
  In = 8,
}

/** Top-level search state snapshot. Read by useSearchState. */
export interface SearchState {
  readonly query: string;
  readonly resultCount: number;
  readonly itemCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly sortField: string;
  readonly sortDirection: number;
  readonly filterCount: number;
  readonly dataVersion: number;
}

/** Per-result state snapshot. Read by useSearchResult. */
export interface SearchResult {
  readonly index: number;
  readonly id: string;
  readonly exists: boolean;
}

// ============================================
// State machine engine types
// ============================================

/** Top-level state machine state snapshot. Read by useStateMachineState. */
export interface StateMachineState {
  readonly currentState: string;
  readonly currentStateLabel: string;
  readonly previousState: string;
  readonly pendingGuard: string;
  readonly guardId: string;
  readonly transitionCount: number;
  readonly availableEventCount: number;
  readonly activeStateCount: number;
  readonly contextJson: string;
  readonly dataVersion: number;
}

/** Per-state match snapshot. Read by useStateMatch. */
export interface StateMatch {
  readonly stateId: string;
  readonly isActive: boolean;
  readonly label: string;
}

// ============================================
// API engine types
// ============================================

/** Request lifecycle status. */
export enum RequestStatus {
  Idle = 0,
  Loading = 1,
  Success = 2,
  Error = 3,
  Cancelled = 4,
}

/** API response format. */
export enum ApiFormat {
  Json = 0,
  FlatBuffer = 1,
}

/** API parameter source. */
export enum ParamSource {
  Query = 0,
  Body = 1,
  Path = 2,
  Header = 3,
}

/** Top-level API state snapshot. Read by useApiState. */
export interface ApiState {
  readonly endpointCount: number;
  readonly activeRequestCount: number;
  readonly dataVersion: number;
}

/** Per-request state snapshot. Read by useRequest. */
export interface RequestState {
  readonly requestId: number;
  readonly endpointId: string;
  readonly status: RequestStatus;
  readonly error: string;
  readonly hasResponse: boolean;
}

// ============================================
// VirtualScroll engine types
// ============================================

/** Scroll alignment for scroll-to-index. */
export enum ScrollAlign { Start = 0, Center = 1, End = 2 }

/** Top-level virtual scroll state snapshot. Read by useVirtualScrollState. */
export interface VirtualScrollState {
  readonly itemCount: number;
  readonly viewportHeight: number;
  readonly overscanCount: number;
  readonly scrollOffset: number;
  readonly totalHeight: number;
  readonly visibleStart: number;
  readonly visibleEnd: number;
  readonly visibleCount: number;
  readonly defaultItemHeight: number;
  readonly anchor: number;
  readonly dataVersion: number;
}

/** Per-item state snapshot. Read by useVirtualScrollItem. */
export interface VirtualScrollItem {
  readonly index: number;
  readonly top: number;
  readonly height: number;
  readonly isVisible: boolean;
}

// ============================================
// Validation engine types
// ============================================

/** Validation rule type. */
export enum ValidationRuleType {
  Required = 0,
  Min = 1,
  Max = 2,
  MinLength = 3,
  MaxLength = 4,
  Pattern = 5,
  Email = 6,
  Custom = 7,
}

/** Cross-field rule type. */
export enum CrossFieldRuleType {
  Equal = 0,
  NotEqual = 1,
  GreaterThan = 2,
  LessThan = 3,
  Custom = 4,
}

/** Top-level validation state snapshot. Read by useValidationState. */
export interface ValidationState {
  readonly ruleCount: number;
  readonly schemaCount: number;
  readonly pendingValidationCount: number;
  readonly dataVersion: number;
}

/** Per-schema validation state snapshot. */
export interface SchemaValidation {
  readonly schemaId: string;
  readonly errorCount: number;
  readonly isValid: boolean;
}

/** Per-field validation state snapshot. Read by useFieldValidation. */
export interface FieldValidation {
  readonly schemaId: string;
  readonly field: string;
  readonly errorCount: number;
  readonly hasError: boolean;
  readonly firstError: string;
}

// ============================================
// Selection engine types
// ============================================

/** Selection mode. */
export enum SelectionMode { Single = 0, Multi = 1, Range = 2 }

/** Focus direction for keyboard navigation. */
export enum FocusDirection { Up = 0, Down = 1, Left = 2, Right = 3 }

/** Top-level selection state snapshot. Read by useSelectionState. */
export interface SelectionState {
  readonly mode: number;
  readonly itemCount: number;
  readonly selectedCount: number;
  readonly focusId: string;
  readonly anchorId: string;
  readonly dataVersion: number;
}

/** Per-item selection state snapshot. Read by useSelectionItem. */
export interface SelectionItem {
  readonly id: string;
  readonly isSelected: boolean;
  readonly isFocused: boolean;
  readonly index: number;
}

// ============================================
// CommandPalette engine types
// ============================================

/** Top-level command palette state snapshot. Read by useCommandPaletteState. */
export interface CommandPaletteState {
  readonly commandCount: number;
  readonly query: string;
  readonly resultCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly lastExecutedId: string;
  readonly dataVersion: number;
}

/** Per-result state snapshot. Read by useCommandPaletteResult. */
export interface CommandPaletteResult {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly score: number;
  readonly isEnabled: boolean;
  readonly keybinding: string;
}

