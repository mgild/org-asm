# Skill: Real-Time Rendering at 60fps

## When to Use
When building UIs that update at 60fps (charts, animations, games, simulations). This is the real-time rendering pattern within orgASM — one of several ways the Rust Model exposes state to the TypeScript View. The core challenge: 60fps data must NEVER trigger React re-renders.

## Architecture: Three-Speed Data Flow

```
60fps: Engine.tick() --> Canvas/DOM        (module-level, no React)
10fps: Throttled store --> React re-render (RxJS/ThrottledStateSync --> Zustand)
 1fps: Config changes --> Engine.set_xxx() (user interaction)
```

Never mix these speeds. If 60fps data flows into React state, you get 60 re-renders per second. The browser cannot reconcile the virtual DOM that fast, leading to dropped frames, high CPU, and laggy UI.

## Pattern 1: Module-Level Engine
Instantiate the engine OUTSIDE any React component. This makes it accessible from animation loops, WebSocket handlers, and canvas plugins without React overhead:

```ts
// At module top level -- no React involvement
import { Engine } from '../../pkg/my_engine';
await init();

const engine = new Engine();
let lastFrame: Float64Array | null = null;
let lastDataVersion = 0;
let chartTimestamps: ArrayLike<number> = [];
let chartValues: ArrayLike<number> = [];
```

Why module-level instead of `useRef`: Refs are per-component-instance and only accessible inside the component. Module-level state is shared across all renders and accessible from animation loops, canvas plugin hooks, and WebSocket handlers -- all of which run outside React's render cycle.

## Pattern 2: requestAnimationFrame Loop
The animation loop calls `engine.tick()` once per frame and applies the result directly to the DOM. No `setState` calls in the hot path:

```ts
function startAnimation() {
    function animate() {
        const nowMs = Date.now();

        // ONE WASM CALL - returns all precomputed values
        const frame = engine.tick(nowMs);
        lastFrame = frame;

        // Apply to DOM directly (no setState!)
        if (appRef.current) {
            const s = appRef.current.style;
            s.setProperty('--vignette-alpha', String(frame[F.VIG_ALPHA]));
            s.setProperty('--border-glow-alpha', String(frame[F.BORDER_ALPHA]));
        }

        // Shake effect on chart container
        if (chartContainerRef.current && frame[F.SHAKE_INTENSITY] > 0.01) {
            const si = frame[F.SHAKE_INTENSITY];
            const sx = (Math.random() - 0.5) * 2 * si;
            const sy = (Math.random() - 0.5) * 2 * si;
            chartContainerRef.current.style.transform = `translate(${sx}px, ${sy}px)`;
        }

        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}
```

Or use the framework's AnimationLoop class with registered consumers:

```ts
import { AnimationLoop } from '../framework/view/AnimationLoop';

const loop = new AnimationLoop(engine);
loop.addConsumer(chartDataConsumer);   // priority 0 (data first)
loop.addConsumer(effectApplicator);    // priority 10 (DOM effects)
loop.addConsumer(throttledStateSync);  // priority 20 (React last)
loop.start();
```

For multiple engines, use MultiAnimationLoop to share a single rAF:

```ts
import { MultiAnimationLoop } from '../framework/view/MultiAnimationLoop';

const shared = new MultiAnimationLoop();
const obHandle = shared.addEngine(obTickSource);
const chartHandle = shared.addEngine(chartTickSource);

obHandle.addConsumer(obChartConsumer);
chartHandle.addConsumer(priceEffects);

shared.start(); // one rAF ticks both engines
```

## Pattern 3: Versioned Data Copy
Copy chart data from WASM only when the data version changes. This prevents copying large Float64Arrays on frames where no new data arrived:

```ts
let lastDataVersion = 0;
let chartTimestamps: ArrayLike<number> = [];
let chartValues: ArrayLike<number> = [];

// Inside animate():
const ver = engine.data_version();
if (ver !== lastDataVersion) {
    chartTimestamps = engine.get_timestamps();
    chartValues = engine.get_values();
    lastDataVersion = ver;
}
chart.setData([chartTimestamps as number[], chartValues as number[]], false);
```

The framework's ChartDataConsumer encapsulates this pattern:

```ts
import { ChartDataConsumer } from '../framework/view/ChartDataConsumer';

const chartConsumer = new ChartDataConsumer(engine, F.WINDOW_SECONDS);
chartConsumer.setSink({
    setData: (ts, vals) => chart.setData([ts as number[], vals as number[]], false),
    setTimeWindow: (min, max) => chart.setScale('x', { min, max }),
});
```

## Pattern 4: Throttled React Sync
Bridge 60fps frame data to React at ~10fps using throttled updates. Two approaches:

**Direct throttle in animation loop:**
```ts
let lastUpdateRef = 0;

// Inside animate():
if (frame[F.IS_ACTIVE] > 0.5 && nowMs - lastUpdateRef > 100) {
    updateSession(frame[F.RESULT_PERCENT], frame[F.ELAPSED]);
    lastUpdateRef = nowMs;
}
```

**Framework ThrottledStateSync:**
```ts
import { ThrottledStateSync } from '../framework/view/ThrottledStateSync';

const sync = new ThrottledStateSync(100);  // 100ms = ~10fps
sync
  .setActiveFlag(F.IS_ACTIVE)
  .addMapping(
    (result, elapsed) => store.getState().updateSession(result, elapsed),
    F.RESULT_PERCENT, F.ELAPSED
  )
  .addConditionalMapping(F.AUTO_ENDED, (frame) => {
    store.getState().endSession(frame[F.RESULT_VALUE]);
  });
```

Conditional mappings fire IMMEDIATELY (not throttled) because state transitions like auto-end must reflect in React without delay.

## Pattern 5: Pre-allocated Buffers
Avoid allocations in the animation loop. Pre-allocate typed arrays and reuse them:

```ts
// Pre-allocated at module level -- reused every frame
const avgYBuf = new Float64Array(4000);

// In drawSeries hook:
const segCount = ptsLen - 1;
for (let i = 0; i < segCount; i++) {
    avgYBuf[i] = (ptsY[i] + ptsY[i + 1]) / 2;
}
const colors = batch_segment_colors(avgYBuf.subarray(0, segCount), midY, top, height);
```

Also pre-allocate point buffers for canvas rendering:
```ts
const ptsX: number[] = [];
const ptsY: number[] = [];
let ptsLen = 0;
```

Why: Every `new Float64Array()` or `new Array()` inside the animation loop creates garbage. When the GC runs, it pauses the main thread for 1-5ms -- enough to drop frames.

## Pattern 6: Canvas Plugin (uPlot drawSeries)
Read from module-level `lastFrame`, not React state. Canvas drawing happens inside chart library hooks which run outside React:

```ts
hooks: {
    drawSeries: (u: uPlot, si: number) => {
        if (si !== 1 || u.data[0].length < 2) return;
        if (!lastFrame) return;

        const ctx = u.ctx;
        const blend = lastFrame[F.ACTION_BLEND];
        const accentRgb: [number, number, number] = [
            lastFrame[F.ACCENT_R],
            lastFrame[F.ACCENT_G],
            lastFrame[F.ACCENT_B],
        ];

        // Use precomputed values to drive canvas rendering
        if (blend > 0.01) {
            ctx.shadowBlur = (6 + lastFrame[F.PULSE] * 10) * devicePixelRatio;
            ctx.shadowColor = `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},1)`;
        }
        // ...draw with precomputed values...
    }
}
```

## Pattern 7: RxJS Throttled Streams for WebSocket Data
Use RxJS to throttle high-frequency WebSocket data before it reaches Zustand:

```ts
import { Subject, throttleTime } from 'rxjs';

const valueStream = new Subject<number>();
const throttledValue$ = valueStream.pipe(throttleTime(100));

throttledValue$.subscribe((value) => {
    useChartStore.getState().setValue(value);
});

export const emitValue = (v: number) => valueStream.next(v);
```

In the WebSocket handler:
```ts
engine.add_data_point(value, timestampSec, Date.now());
emitValue(engine.value);  // Throttled to 100ms before reaching React
```

Or use the framework's StoreFactory:
```ts
import { createThrottledStream } from '../framework/model/StoreFactory';

const valueStream = createThrottledStream<number>(100);
valueStream.subscribe((value) => store.getState().setValue(value));
```

## Common Mistakes
1. **Using `useState` for animation values** -- 60 re-renders/sec kills performance
2. **Creating objects in the animation loop** -- GC pauses cause dropped frames
3. **Reading DOM in the animation loop** -- Layout thrashing (read then write, never read-write-read)
4. **Multiple WASM calls per frame** -- Each boundary crossing has overhead; use one `tick()` call
5. **Copying chart data every frame** -- Use version-gated copying to skip frames with no new data
6. **Inline function creation in rAF** -- Define callbacks outside the loop to avoid closure allocations
