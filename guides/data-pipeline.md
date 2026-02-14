# Skill: Real-Time Data Pipeline

## When to Use
When connecting real-time data sources (WebSocket, SSE, polling) to WASM engines with React UIs. The pipeline must handle three different update frequencies without them interfering with each other.

## Pipeline Architecture

```
WebSocket --> JSON.parse (JS) --> engine.add_data_point() (WASM)
                                       |
                                       v
                                 engine internal state
                                       |
                          +------------+------------+
                          |                         |
                          v                         v
                    tick() --> frame buffer    emitValue() (RxJS)
                          |                         |
                          v                         v
                    DOM/Canvas (60fps)         Zustand store (~10fps)
                                                    |
                                                    v
                                              React re-render
```

The key insight: data enters through the engine (Controller --> Model), then fans out through two separate paths -- one fast (60fps canvas/DOM via tick), one slow (throttled React store).

## Step 1: WebSocket Connection
Use auto-reconnect with exponential backoff. The connection lifecycle is separate from message handling:

**Direct approach (used in reference implementation):**
```ts
export const useWebSocket = (onMessage?: (data: string) => void) => {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
        wsRef.current = ws;

        ws.onmessage = (event) => onMessage?.(event.data);
        ws.onclose = () => {
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
    }, [onMessage]);

    useEffect(() => {
        connect();
        return () => {
            wsRef.current?.close();
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        };
    }, [connect]);
};
```

**Framework approach:**
```ts
import { WebSocketPipeline } from '../framework/controller/WebSocketPipeline';

const pipeline = new WebSocketPipeline({
    url: `${wsProtocol}//${location.host}/ws`,
    reconnectDelayMs: 3000,
});
pipeline
    .onMessage(handleMessage)
    .onConnect(() => console.log('Connected'))
    .onDisconnect(() => console.log('Disconnected'));
pipeline.connect();
```

## Step 2: Message Handling
Parse JSON in JS (native C++ parser), extract primitives, pass to engine methods. Never pass strings or objects across the WASM boundary:

```ts
const handleWsMessage = useCallback((raw: string) => {
    try {
        const msg = JSON.parse(raw);
        if (msg.data.type === 'data_update') {
            // Parse in JS, pass primitives to WASM
            const value = parseFloat(msg.data.value);
            const timestampSec = msg.data.timestamp / 1000;
            engine.add_data_point(value, timestampSec, Date.now());

            // Throttled emit to React store
            emitValue(engine.value);
            emitStats({
                delta: engine.delta_5m,
                deltaPct: engine.delta_pct_5m,
            });
        } else if (msg.data.type === 'stats_update') {
            engine.update_stats(
                parseFloat(msg.data.max),
                parseFloat(msg.data.min),
                parseFloat(msg.data.total),
            );
            emitStats({
                max24h: engine.max_24h,
                min24h: engine.min_24h,
                total24h: engine.total_24h,
            });
        }
    } catch (err) {
        console.error('WS message error:', err);
    }
}, []);
```

Notice the pattern: after calling engine methods, read derived values back via `#[wasm_bindgen(getter)]` properties (e.g., `engine.value`, `engine.delta_5m`). These are cheap single-value reads, not the frame buffer.

## Step 3: Throttled React Updates
High-frequency data must be throttled before reaching Zustand to prevent React re-render storms:

```ts
import { Subject, throttleTime } from 'rxjs';

// Create throttled streams (100ms = max 10 updates/sec for value)
const valueStream = new Subject<number>();
const statsStream = new Subject<Partial<StatsData>>();

const throttledValue$ = valueStream.pipe(throttleTime(100));
const throttledStats$ = statsStream.pipe(throttleTime(200));

// Wire streams to store
throttledValue$.subscribe((value) => {
    useChartStore.getState().setValue(value);
});
throttledStats$.subscribe((stats) => {
    useChartStore.getState().setStats(stats);
});

// Export emitters for use in message handler
export const emitValue = (value: number) => valueStream.next(value);
export const emitStats = (stats: Partial<StatsData>) => statsStream.next(stats);
```

Or use the framework:
```ts
import { createThrottledStream } from '../framework/model/StoreFactory';

const valueStream = createThrottledStream<number>(100);
const statsStream = createThrottledStream<Partial<StatsData>>(200);
```

## Step 4: History Initialization
Load historical data once on app mount. Use Float64Array for batch transfer to WASM (efficient, no per-element boundary crossing):

```ts
const { data: historyData } = useQuery({
    queryKey: ['dataHistory'],
    queryFn: fetchHistory,
    refetchOnMount: false,
    staleTime: Infinity,  // Fetch once, never refetch
});

// When history data arrives, load into engine
if (historyData) {
    const times = new Float64Array(historyData.dataPoints.map(t => t.time));
    const values = new Float64Array(historyData.dataPoints.map(t => t.value));
    engine.load_history(times, values);
    startAnimation();  // Begin 60fps loop only after data is loaded
}
```

On the Rust side, `load_history` accepts `&[f64]` which maps to Float64Array with zero-copy input:

```rust
#[wasm_bindgen]
pub fn load_history(&mut self, timestamps: &[f64], values: &[f64]) {
    if timestamps.len() != values.len() { return; }
    for i in 0..timestamps.len() {
        self.timestamps.push(timestamps[i]);
        self.values.push(values[i]);
    }
    if let Some(&last) = values.last() {
        self.value = last;
        self.prev_value = last;
    }
    self.data_version += 1;
}
```

## Step 5: Configuration Sync
User settings flow from React --> Engine at interaction time. Use `useEffect` to sync:

```ts
useEffect(() => { engine.set_config_param_a(paramA); }, [paramA]);
useEffect(() => { engine.set_config_param_b(paramB); }, [paramB]);
```

On the Rust side, individual setters avoid JSON parsing overhead:

```rust
#[wasm_bindgen]
pub fn set_config_param_a(&mut self, v: f64) { self.config_param_a = v; }

#[wasm_bindgen]
pub fn set_config_param_b(&mut self, v: f64) { self.config_param_b = v; }
```

## Step 6: User Actions (Session Start/End)
User interactions call engine methods directly, then sync the result to the store:

```ts
const handleActionStart = useCallback(() => {
    engine.open_action(actionType, Date.now());
    openActionStore(engine.value, actionType);
}, [actionType, openActionStore]);

const handleActionEnd = useCallback(() => {
    const result = engine.close_action(Date.now());
    closeActionStore(result);
}, [closeActionStore]);
```

The engine method returns a result which the store uses to update React state. The engine owns the computation; the store owns the display.

## Framework Controller: InputController
For complex interaction patterns, use the InputController to decouple DOM events from engine calls:

```ts
import { InputController } from '../framework/controller/InputController';

const input = new InputController();
input
    .onAction('session', {
        start: (params) => {
            engine.open_action(params.actionType as string, Date.now());
            store.getState().openAction(engine.value, params.actionType as string);
        },
        end: () => {
            const result = engine.close_action(Date.now());
            store.getState().closeAction(result);
            return result;
        },
    })
    .onActionEnd((name, result) => {
        console.log(`Action ${name} ended with result: ${result}`);
    });

// Bind to DOM
chartEl.onmousedown = () => input.startAction('session', { actionType });
const cleanup = input.bindGlobalRelease();
```

## Key Principles
1. **Parse JSON in JS** (native C++ parser), not WASM -- saves ~30KB binary size
2. **Pass primitives (f64) to engine**, not objects or strings
3. **Engine owns data arrays** -- no parallel arrays maintained in JS
4. **Throttle ALL React state updates** (100-200ms) to prevent re-render storms
5. **History loads once** via Float64Array batch, not per-element
6. **Start animation loop AFTER history loads** -- prevents rendering empty charts
7. **Config syncs via useEffect** -- runs only when the value actually changes
