/**
 * BatchedPathRenderer — Groups canvas line segments by color for efficient rendering.
 *
 * Problem: Per-segment strokeStyle changes on Canvas 2D are expensive.
 * Each change forces a GPU state flush. With 500+ data points at 60fps,
 * this means 500+ state changes per frame — the single biggest rendering bottleneck.
 *
 * Solution: Collect all segments, group by quantized color, render each group
 * as a single Path2D. With 16-32 color buckets, state changes drop from ~500
 * to ~16-32 per frame (10-30x improvement).
 *
 * Usage:
 *   const renderer = new BatchedPathRenderer();
 *
 *   // In uPlot drawSeries hook (or any canvas render callback):
 *   renderer.begin();
 *   for (let i = 1; i < points; i++) {
 *     const color = BatchedPathRenderer.quantize(r, g, b);
 *     renderer.segment(x0, y0, x1, y1, color);
 *   }
 *   renderer.flush(ctx, 2 * devicePixelRatio);
 */

import type { IFrameConsumer } from '../core/interfaces';

export class BatchedPathRenderer {
  private buckets = new Map<string, Path2D>();
  private bucketOrder: string[] = [];

  /**
   * Quantize an RGB color to reduce unique strokeStyle values.
   * Fewer unique colors = fewer GPU state flushes = faster rendering.
   *
   * @param r - Red (0-255)
   * @param g - Green (0-255)
   * @param b - Blue (0-255)
   * @param steps - Quantization levels per channel (default 16, giving 4096 max buckets)
   * @returns CSS rgb() string suitable for strokeStyle
   */
  static quantize(r: number, g: number, b: number, steps = 16): string {
    const s = 256 / steps;
    const qr = Math.round(Math.round(r / s) * s);
    const qg = Math.round(Math.round(g / s) * s);
    const qb = Math.round(Math.round(b / s) * s);
    return `rgb(${qr},${qg},${qb})`;
  }

  /** Reset for a new frame. Call at the start of each render pass. */
  begin(): void {
    this.buckets.clear();
    this.bucketOrder.length = 0;
  }

  /** Add a line segment with a CSS color string. Use quantize() for best batching. */
  segment(x0: number, y0: number, x1: number, y1: number, color: string): void {
    let path = this.buckets.get(color);
    if (!path) {
      path = new Path2D();
      this.buckets.set(color, path);
      this.bucketOrder.push(color);
    }
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  }

  /** Render all batched segments to the canvas context. One stroke call per color bucket. */
  flush(ctx: CanvasRenderingContext2D, lineWidth: number, lineJoin: CanvasLineJoin = 'miter'): void {
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = lineJoin;
    for (const color of this.bucketOrder) {
      ctx.strokeStyle = color;
      ctx.stroke(this.buckets.get(color)!);
    }
    ctx.restore();
  }

  /** Number of unique color buckets in the current frame. */
  get bucketCount(): number {
    return this.buckets.size;
  }
}

/**
 * Factory to create an IFrameConsumer that delegates canvas rendering
 * to a callback using a BatchedPathRenderer.
 *
 * Generic over frame type F: the callback receives the frame as-is.
 * Defaults to Float64Array for backward compatibility.
 *
 * Useful when you want to integrate batched rendering into the
 * AnimationLoop consumer pipeline without subclassing.
 *
 * Usage:
 *   const renderer = new BatchedPathRenderer();
 *   const consumer = createBatchedRenderConsumer<MyFrame>(renderer, 5, (frame, batch) => {
 *     batch.begin();
 *     // ... add segments from frame data ...
 *     batch.flush(ctx, lineWidth);
 *   });
 *   animationLoop.addConsumer(consumer);
 */
export function createBatchedRenderConsumer<F = Float64Array>(
  renderer: BatchedPathRenderer,
  priority: number,
  onFrame: (frame: F, batch: BatchedPathRenderer, nowMs: number) => void,
): IFrameConsumer<F> {
  return {
    priority,
    onFrame(frame: F, nowMs: number): void {
      onFrame(frame, renderer, nowMs);
    },
  };
}
