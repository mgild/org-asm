/**
 * Core types for the WASM Engine Framework.
 * All real-time WASM+React apps built on this framework share these contracts.
 *
 * Design principle: WASM engines return flat Float64Array buffers to minimize
 * boundary-crossing overhead. These types provide the vocabulary for describing,
 * accessing, and consuming those buffers on the JS side.
 */

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

