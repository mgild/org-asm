/**
 * MultiAnimationLoop — Single rAF loop that ticks multiple engines.
 *
 * When an app has multiple independent engines (e.g. orderbook + chart + analytics),
 * each typically gets its own AnimationLoop with its own requestAnimationFrame callback.
 * MultiAnimationLoop consolidates them into a single rAF, reducing frame scheduling
 * overhead and ensuring all engines tick at the same timestamp.
 *
 * Each engine is registered via addEngine(), which returns an EngineHandle<F> that
 * implements IAnimationLoop<F>. The handle manages per-engine consumers and can be
 * passed to useFrame() and other consumer hooks as a drop-in for AnimationLoop.
 *
 * Usage:
 *   const multi = new MultiAnimationLoop();
 *   const obHandle = multi.addEngine(obTickSource);
 *   const chartHandle = multi.addEngine(chartTickSource);
 *   multi.start();
 *   obHandle.addConsumer(myObConsumer);
 *   chartHandle.addConsumer(myChartConsumer);
 */

import type { IAnimationLoop, IFrameConsumer } from '../core/interfaces';

interface EngineSlot {
  engine: { tick(nowMs: number): unknown };
  consumers: IFrameConsumer<unknown>[];
}

/**
 * EngineHandle — Per-engine view into a MultiAnimationLoop.
 *
 * Implements IAnimationLoop<F> so it works anywhere AnimationLoop does
 * (useFrame, addConsumer, etc.). Each handle manages its own consumer list
 * scoped to a single engine within the shared loop.
 */
export class EngineHandle<F> implements IAnimationLoop<F> {
  /** @internal */ readonly _slot: EngineSlot;
  private _loop: MultiAnimationLoop;
  private _removed = false;

  /** @internal */
  constructor(loop: MultiAnimationLoop, slot: EngineSlot) {
    this._loop = loop;
    this._slot = slot;
  }

  addConsumer(consumer: IFrameConsumer<F>): void {
    if (this._removed) return;
    const consumers = this._slot.consumers;
    consumers.push(consumer as IFrameConsumer<unknown>);
    consumers.sort((a, b) => a.priority - b.priority);
  }

  removeConsumer(consumer: IFrameConsumer<F>): void {
    const idx = this._slot.consumers.indexOf(consumer as IFrameConsumer<unknown>);
    if (idx >= 0) this._slot.consumers.splice(idx, 1);
  }

  /** Remove this engine from the shared loop. */
  remove(): void {
    if (this._removed) return;
    this._removed = true;
    this._loop._removeSlot(this._slot);
  }

  /** Starts the shared loop. Idempotent. */
  start(): void {
    this._loop.start();
  }

  /** Removes this engine from the shared loop (does not stop other engines). */
  stop(): void {
    this.remove();
  }

  get running(): boolean {
    return !this._removed && this._loop.running;
  }
}

export class MultiAnimationLoop {
  private _running = false;
  private _frameId: number | null = null;
  private _slots: EngineSlot[] = [];

  /** Register an engine tick source. Returns a handle for managing per-engine consumers. */
  addEngine<F>(engine: { tick(nowMs: number): F }): EngineHandle<F> {
    const slot: EngineSlot = { engine, consumers: [] };
    this._slots.push(slot);
    return new EngineHandle<F>(this, slot);
  }

  /** @internal */
  _removeSlot(slot: EngineSlot): void {
    const idx = this._slots.indexOf(slot);
    if (idx >= 0) this._slots.splice(idx, 1);
  }

  /** Start the shared loop. Idempotent. */
  start(): void {
    if (this._running) return;
    this._running = true;

    const animate = () => {
      if (!this._running) return;

      const nowMs = Date.now();

      for (const slot of this._slots) {
        const frame = slot.engine.tick(nowMs);
        for (const consumer of slot.consumers) {
          consumer.onFrame(frame, nowMs);
        }
      }

      this._frameId = requestAnimationFrame(animate);
    };

    this._frameId = requestAnimationFrame(animate);
  }

  /** Stop the shared loop and all engines. Idempotent. */
  stop(): void {
    this._running = false;
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  get running(): boolean {
    return this._running;
  }

  get engineCount(): number {
    return this._slots.length;
  }
}
