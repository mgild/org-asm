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

