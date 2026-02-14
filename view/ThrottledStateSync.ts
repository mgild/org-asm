/**
 * ThrottledStateSync — Syncs frame data to React state at throttled intervals.
 *
 * The pattern: throttled fan-out with immediate conditionals.
 *
 * The animation loop runs at 60fps, but React only needs updates at ~10fps
 * (100ms throttle) for smooth UI without re-render storms. This consumer
 * bridges the gap: it reads specific frame offsets and calls store actions
 * at a configurable lower rate.
 *
 * Two mapping types serve different needs:
 *
 * 1. Throttled mappings: Read frame offsets, call a handler with the values.
 *    These fire at most once per throttleMs interval. Use for continuous
 *    values like percentages, elapsed time, counters.
 *
 * 2. Conditional mappings: Fire IMMEDIATELY when a boolean flag in the frame
 *    buffer becomes true. These are NOT throttled because state transitions
 *    must be reflected in React without delay. The handler receives the full
 *    frame for extracting associated values.
 *
 * An optional "active flag" gates all throttled mappings. When set, throttled
 * updates only run if frame[activeFlag] > 0.5. Use this to skip updates
 * when there's no active session.
 *
 * Priority 20 ensures this runs after chart sync (0) and DOM effects (10).
 * React state updates are the least latency-sensitive consumer.
 *
 * Usage:
 *   const sync = new ThrottledStateSync(100);
 *   sync.addMapping((score, elapsed) => {
 *     store.getState().updateSession(score, elapsed);
 *   }, F.SCORE, F.ELAPSED);
 *   sync.addConditionalMapping(F.SESSION_ENDED, (frame) => {
 *     store.getState().endSession(frame[F.FINAL_SCORE]);
 *   });
 */

import type { IFrameConsumer } from '../core/interfaces';

interface FrameMapping {
  offsets: number[];
  handler: (...values: number[]) => void;
}

interface ConditionalMapping {
  flagOffset: number;
  handler: (frame: Float64Array) => void;
}

export class ThrottledStateSync implements IFrameConsumer {
  readonly priority = 20;

  private lastUpdate = 0;
  private throttleMs: number;
  private mappings: FrameMapping[] = [];
  private conditionals: ConditionalMapping[] = [];
  private conditionFlagOffset: number | null = null;

  /**
   * @param throttleMs - Minimum interval between throttled updates (e.g., 100 for ~10fps React updates)
   */
  constructor(throttleMs: number) {
    this.throttleMs = throttleMs;
  }

  /**
   * Require a boolean flag to be true before any throttled mappings run.
   *
   * When set, throttled updates are skipped entirely if frame[offset] <= 0.5.
   * Conditional mappings (immediate) are unaffected by this flag.
   *
   * @returns this, for fluent chaining
   */
  setActiveFlag(offset: number): this {
    this.conditionFlagOffset = offset;
    return this;
  }

  /**
   * Add a throttled mapping from frame buffer offsets to a handler.
   *
   * The handler receives the current values at the specified offsets,
   * but only fires at most once per throttleMs interval.
   *
   * @param handler - Receives values in the order of the offsets
   * @param offsets - Frame buffer offsets to read
   * @returns this, for fluent chaining
   */
  addMapping(handler: (...values: number[]) => void, ...offsets: number[]): this {
    this.mappings.push({ offsets, handler });
    return this;
  }

  /**
   * Add a conditional mapping that fires immediately when a flag becomes true.
   *
   * NOT throttled — state transitions must be reflected in React without delay.
   * The handler receives the full frame so it can extract any associated values.
   *
   * NOTE: This fires on EVERY frame where the flag is true. If the flag stays
   * true for multiple frames, the handler must be idempotent or the engine
   * must clear the flag after one frame.
   *
   * @returns this, for fluent chaining
   */
  addConditionalMapping(flagOffset: number, handler: (frame: Float64Array) => void): this {
    this.conditionals.push({ flagOffset, handler });
    return this;
  }

  /**
   * Process a frame. Fires immediate conditionals, then throttled mappings
   * if the interval has elapsed and the active flag (if set) is true.
   */
  onFrame(frame: Float64Array, nowMs: number): void {
    // Immediate conditionals — always checked, never throttled
    for (const cond of this.conditionals) {
      if (frame[cond.flagOffset] > 0.5) {
        cond.handler(frame);
      }
    }

    // Gate throttled mappings on the active flag
    if (this.conditionFlagOffset !== null && frame[this.conditionFlagOffset] < 0.5) {
      return;
    }

    // Throttle check
    if (nowMs - this.lastUpdate < this.throttleMs) return;
    this.lastUpdate = nowMs;

    // Fire all throttled mappings with current values
    for (const mapping of this.mappings) {
      const values = mapping.offsets.map(o => frame[o]);
      mapping.handler(...values);
    }
  }
}
