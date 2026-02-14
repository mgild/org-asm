/**
 * MessageParser — Abstract base class for message parsing.
 *
 * Prefer WasmIngestParser for all new projects. It delegates raw strings
 * to the Rust engine's ingest_message(), keeping all data processing in
 * WASM: one boundary crossing, zero JS object allocation.
 *
 * This base class exists as an escape hatch for cases where WASM-side
 * parsing isn't viable (e.g., binary protocols that need Web APIs,
 * or prototyping before the Rust engine is ready).
 */

import type { DataResult } from '../core/types';
import { INGEST_DATA_UPDATED, INGEST_STATS_UPDATED } from '../core/types';
import type { IWasmIngestEngine } from '../core/interfaces';

export interface EngineDataTarget {
  addDataPoint(value: number, timestamp: number, nowMs: number): void;
  updateStats?(values: Record<string, number>): void;
}

export abstract class MessageParser {
  /**
   * Parse a raw WebSocket message and feed data into the engine.
   *
   * @param raw - Raw message string (usually JSON)
   * @param engine - Engine to feed data into
   * @param nowMs - Current time in milliseconds (Date.now())
   * @returns What was updated (for downstream consumers to know what to emit)
   */
  abstract parse(raw: string, engine: EngineDataTarget, nowMs: number): DataResult;
}

/**
 * WasmIngestParser — Delegates message parsing to the WASM engine.
 *
 * Instead of JSON.parse in JS → extract fields → call engine methods,
 * the raw string goes to WASM where serde_json handles parsing.
 * One boundary crossing replaces many. Eliminates JS object allocation.
 *
 * The engine's ingest_message() returns a bitmask:
 *   bit 0 (1): data updated (trade)
 *   bit 1 (2): stats updated (ticker)
 *
 * Register callbacks with .onTrade() and .onTicker() for post-ingest
 * side effects (e.g., emitting throttled React state updates).
 *
 * Usage:
 *   const parser = new WasmIngestParser(engine)
 *     .onTrade(() => emitPrice(engine.price))
 *     .onTicker(() => emitStats({ high: engine.high_24h }));
 *   pipeline.onMessage((raw) => parser.parse(raw, adapter, Date.now()));
 */
export class WasmIngestParser extends MessageParser {
  private target: IWasmIngestEngine;
  private tradeCallbacks: Array<() => void> = [];
  private tickerCallbacks: Array<() => void> = [];

  constructor(target: IWasmIngestEngine) {
    super();
    this.target = target;
  }

  /** Register a callback fired after a trade/data update. */
  onTrade(cb: () => void): this {
    this.tradeCallbacks.push(cb);
    return this;
  }

  /** Register a callback fired after a ticker/stats update. */
  onTicker(cb: () => void): this {
    this.tickerCallbacks.push(cb);
    return this;
  }

  parse(raw: string, _engine: EngineDataTarget, nowMs: number): DataResult {
    const result = this.target.ingest_message(raw, nowMs);
    const dataUpdated = (result & INGEST_DATA_UPDATED) !== 0;
    const statsUpdated = (result & INGEST_STATS_UPDATED) !== 0;
    if (dataUpdated) {
      for (const cb of this.tradeCallbacks) cb();
    }
    if (statsUpdated) {
      for (const cb of this.tickerCallbacks) cb();
    }
    return { dataUpdated, statsUpdated };
  }
}
