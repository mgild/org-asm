/**
 * ChartDataConsumer — Syncs engine time-series data to a chart library.
 *
 * The pattern: version-gated data copying.
 *
 * WASM engines expose a data_version() counter that increments only when the
 * underlying time-series data actually changes (new data point).
 * At 60fps with data arriving at ~50 messages/sec, roughly 20% of frames have
 * no new data. By checking the version first, we skip expensive Float64Array
 * copies on those frames.
 *
 * This consumer is chart-library-agnostic. It copies timestamps and values from
 * the engine and feeds them to any ChartDataSink implementation. Concrete sinks
 * wrap uPlot, lightweight-charts, or any other chart library behind a stable
 * two-method interface (setData + setTimeWindow).
 *
 * The time window is driven by a frame buffer offset (e.g., the engine computes
 * a "window seconds" value that controls how much history is visible). This keeps
 * window management inside the engine where it can coordinate with zoom/scroll state.
 *
 * Priority 0 ensures chart data is synced before effects (priority 10) or
 * React state (priority 20) — charts are the most latency-sensitive consumer.
 */

import type { IFrameConsumer } from '../core/interfaces';

/** Minimal chart sink contract — implement per chart library. */
export interface ChartDataSink {
  /** Set the full dataset. Called only when data version changes. */
  setData(timestamps: ArrayLike<number>, values: ArrayLike<number>): void;

  /** Set the visible time window in epoch seconds. Called every frame. */
  setTimeWindow(minSec: number, maxSec: number): void;
}

export class ChartDataConsumer implements IFrameConsumer {
  readonly priority = 0;

  private lastVersion = 0;
  private timestamps: ArrayLike<number> = [];
  private values: ArrayLike<number> = [];
  private sink: ChartDataSink | null = null;
  private engine: {
    data_version(): number;
    get_timestamps(): Float64Array;
    get_values(): Float64Array;
  };
  private windowSecondsOffset: number;

  /**
   * @param engine - WASM engine exposing versioned time-series accessors
   * @param windowSecondsOffset - Frame buffer offset containing the visible window duration in seconds
   */
  constructor(
    engine: { data_version(): number; get_timestamps(): Float64Array; get_values(): Float64Array },
    windowSecondsOffset: number,
  ) {
    this.engine = engine;
    this.windowSecondsOffset = windowSecondsOffset;
  }

  /**
   * Create a zero-copy ChartDataConsumer that reads data directly from WASM linear memory.
   *
   * Instead of cloning timestamps/values via get_timestamps()/get_values() (O(n) copy each),
   * creates Float64Array views into WASM memory — zero allocation, zero copy.
   *
   * The views are recreated on each data_version change to handle WASM memory growth
   * (Vec push can cause reallocation, detaching the old memory.buffer).
   *
   * @param engine - WASM engine exposing ptr/len accessors for time-series data
   * @param memory - WebAssembly.Memory from the WASM init result
   * @param windowSecondsOffset - Frame buffer offset for window duration
   */
  static zeroCopy(
    engine: {
      data_version(): number;
      timestamps_ptr(): number;
      timestamps_len(): number;
      values_ptr(): number;
      values_len(): number;
    },
    memory: WebAssembly.Memory,
    windowSecondsOffset: number,
  ): ChartDataConsumer {
    const wrapper = {
      data_version: () => engine.data_version(),
      get_timestamps: () => new Float64Array(memory.buffer, engine.timestamps_ptr(), engine.timestamps_len()),
      get_values: () => new Float64Array(memory.buffer, engine.values_ptr(), engine.values_len()),
    };
    return new ChartDataConsumer(wrapper, windowSecondsOffset);
  }

  /** Set the chart sink that receives data updates. Can be swapped at runtime. */
  setSink(sink: ChartDataSink): void {
    this.sink = sink;
    // Force a data copy on next frame so the new sink gets initial data
    this.lastVersion = 0;
  }

  /**
   * Process a frame. Copies data from WASM only when version changes,
   * then pushes the full dataset and updates the sink's time window every frame.
   * This guarantees full-series redraws when chart scale/window changes.
   */
  onFrame(frame: Float64Array, nowMs: number): void {
    if (!this.sink) return;

    const ver = this.engine.data_version();
    if (ver !== this.lastVersion) {
      this.timestamps = this.engine.get_timestamps();
      this.values = this.engine.get_values();
      this.lastVersion = ver;
    }

    // Always refresh chart data so custom draw hooks can fully recolor/repaint
    // the visible series after any scale/window movement.
    this.sink.setData(this.timestamps, this.values);

    const nowSec = nowMs / 1000;
    const windowSec = frame[this.windowSecondsOffset];
    this.sink.setTimeWindow(nowSec - windowSec, nowSec);
  }
}
