/**
 * ThrottledStateSync — Syncs frame data to React state at throttled intervals.
 *
 * The pattern: throttled fan-out with immediate conditionals.
 *
 * The animation loop runs at 60fps, but React only needs updates at ~10fps
 * (100ms throttle) for smooth UI without re-render storms. This consumer
 * bridges the gap: it reads specific frame values via extractors and calls
 * store actions at a configurable lower rate.
 *
 * Generic over frame type F: extractors are functions (frame: F) => number
 * (or boolean for conditionals). Defaults to Float64Array for backward compatibility.
 *
 * Two mapping types serve different needs:
 *
 * 1. Throttled mappings: Extract values from the frame, call a handler with the values.
 *    These fire at most once per throttleMs interval. Use for continuous
 *    values like percentages, elapsed time, counters.
 *
 * 2. Conditional mappings: Fire IMMEDIATELY when a boolean extractor returns true.
 *    These are NOT throttled because state transitions must be reflected in React
 *    without delay. The handler receives the full frame for extracting associated values.
 *
 * An optional "active flag" extractor gates all throttled mappings. When set, throttled
 * updates only run if the extractor returns true. Use this to skip updates
 * when there's no active session.
 *
 * Priority 20 ensures this runs after chart sync (0) and DOM effects (10).
 * React state updates are the least latency-sensitive consumer.
 *
 * Usage:
 *   const sync = new ThrottledStateSync<MyFrame>(100);
 *   sync.addMapping((score, elapsed) => {
 *     store.getState().updateSession(score, elapsed);
 *   }, f => f.score, f => f.elapsed);
 *   sync.addConditionalMapping(f => f.sessionEnded, (frame) => {
 *     store.getState().endSession(frame.finalScore);
 *   });
 */

import type { IFrameConsumer } from '../core/interfaces';
import type { FieldExtractor, BoolExtractor } from '../core/types';

interface FrameMapping<F> {
  extractors: FieldExtractor<F>[];
  handler: (...values: number[]) => void;
}

interface ConditionalMapping<F> {
  flagExtract: BoolExtractor<F>;
  handler: (frame: F) => void;
}

export class ThrottledStateSync<F = Float64Array> implements IFrameConsumer<F> {
  readonly priority = 20;

  private lastUpdate = 0;
  private throttleMs: number;
  private mappings: FrameMapping<F>[] = [];
  private conditionals: ConditionalMapping<F>[] = [];
  private conditionFlagExtract: BoolExtractor<F> | null = null;

  /**
   * @param throttleMs - Minimum interval between throttled updates (e.g., 100 for ~10fps React updates)
   */
  constructor(throttleMs: number) {
    this.throttleMs = throttleMs;
  }

  /**
   * Require a boolean extractor to return true before any throttled mappings run.
   *
   * When set, throttled updates are skipped entirely if the extractor returns false.
   * Conditional mappings (immediate) are unaffected by this flag.
   *
   * @param extract - Extractor function that reads a boolean value from the frame
   * @returns this, for fluent chaining
   */
  setActiveFlag(extract: BoolExtractor<F>): this {
    this.conditionFlagExtract = extract;
    return this;
  }

  /**
   * Add a throttled mapping from frame extractors to a handler.
   *
   * The handler receives the current values extracted from the frame,
   * but only fires at most once per throttleMs interval.
   *
   * @param handler - Receives values in the order of the extractors
   * @param extractors - Extractor functions that read numeric values from the frame
   * @returns this, for fluent chaining
   */
  addMapping(handler: (...values: number[]) => void, ...extractors: FieldExtractor<F>[]): this {
    this.mappings.push({ extractors, handler });
    return this;
  }

  /**
   * Add a conditional mapping that fires immediately when an extractor returns true.
   *
   * NOT throttled — state transitions must be reflected in React without delay.
   * The handler receives the full frame so it can extract any associated values.
   *
   * NOTE: This fires on EVERY frame where the extractor returns true. If the flag stays
   * true for multiple frames, the handler must be idempotent or the engine
   * must clear the flag after one frame.
   *
   * @param flagExtract - Extractor function that reads a boolean value from the frame
   * @param handler - Receives the full frame when the flag is true
   * @returns this, for fluent chaining
   */
  addConditionalMapping(flagExtract: BoolExtractor<F>, handler: (frame: F) => void): this {
    this.conditionals.push({ flagExtract, handler });
    return this;
  }

  /**
   * Process a frame. Fires immediate conditionals, then throttled mappings
   * if the interval has elapsed and the active flag (if set) is true.
   */
  onFrame(frame: F, nowMs: number): void {
    // Immediate conditionals — always checked, never throttled
    for (const cond of this.conditionals) {
      if (cond.flagExtract(frame)) {
        cond.handler(frame);
      }
    }

    // Gate throttled mappings on the active flag extractor
    if (this.conditionFlagExtract !== null && !this.conditionFlagExtract(frame)) {
      return;
    }

    // Throttle check
    if (nowMs - this.lastUpdate < this.throttleMs) return;
    this.lastUpdate = nowMs;

    // Fire all throttled mappings with current values
    for (const mapping of this.mappings) {
      const values = mapping.extractors.map(e => e(frame));
      mapping.handler(...values);
    }
  }
}
