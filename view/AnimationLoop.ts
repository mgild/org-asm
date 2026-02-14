/**
 * AnimationLoop — Manages the 60fps render cycle.
 *
 * Architecture:
 * 1. Call engine.tick(now) — ONE WASM call per frame
 * 2. Distribute frame data to registered consumers
 * 3. requestAnimationFrame for next frame
 *
 * The pattern here is "single tick, fan-out": the engine is the sole source of truth,
 * and the loop simply distributes its output. No business logic lives in the loop.
 * Consumers are priority-ordered so data-critical work (chart sync) runs before
 * cosmetic work (DOM effects). This guarantees that if a frame budget is blown,
 * the most important consumers still get their data.
 *
 * Consumers implement IFrameConsumer from core/interfaces. The loop owns the
 * lifecycle (start/stop) and the consumer registry. It does NOT own the engine
 * or any consumer — those are injected and managed externally.
 *
 * Performance notes:
 * - The loop does zero allocations per frame (the Float64Array comes from WASM).
 * - Consumer iteration is a simple for-loop over a sorted array.
 * - Date.now() is used instead of performance.now() because WASM engines
 *   typically work in epoch milliseconds for timestamp correlation.
 */

import type { IFrameConsumer } from '../core/interfaces';

export class AnimationLoop {
  private _running = false;
  private frameId: number | null = null;
  private consumers: IFrameConsumer[] = [];
  private engine: { tick(nowMs: number): Float64Array };

  constructor(engine: { tick(nowMs: number): Float64Array }) {
    this.engine = engine;
  }

  /** Register a frame consumer. Consumers are sorted by priority (lower first). */
  addConsumer(consumer: IFrameConsumer): void {
    this.consumers.push(consumer);
    this.consumers.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a frame consumer. */
  removeConsumer(consumer: IFrameConsumer): void {
    const idx = this.consumers.indexOf(consumer);
    if (idx >= 0) this.consumers.splice(idx, 1);
  }

  /** Start the animation loop. Idempotent — calling start() while running is a no-op. */
  start(): void {
    if (this._running) return;
    this._running = true;

    const animate = () => {
      if (!this._running) return;

      const nowMs = Date.now();
      const frame = this.engine.tick(nowMs);

      for (const consumer of this.consumers) {
        consumer.onFrame(frame, nowMs);
      }

      this.frameId = requestAnimationFrame(animate);
    };

    this.frameId = requestAnimationFrame(animate);
  }

  /** Stop the animation loop. Idempotent — calling stop() while stopped is a no-op. */
  stop(): void {
    this._running = false;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  /** Whether the loop is currently running. */
  get running(): boolean {
    return this._running;
  }
}
