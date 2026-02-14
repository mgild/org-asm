/**
 * StoreFactory -- Creates Zustand stores with RxJS throttled streams.
 *
 * Pattern: High-frequency data (60fps) goes through RxJS throttle,
 * then updates Zustand at UI-safe rates (100-200ms).
 * React components subscribe to Zustand, not raw streams.
 *
 * This separates the 60fps data flow (engine -> canvas) from
 * the ~10fps UI flow (store -> React re-render).
 *
 * Architecture:
 *   WebSocket -> engine.add_data_point()  (raw data, any frequency)
 *   rAF loop  -> engine.tick()            (60fps, fills frame buffer)
 *   rAF loop  -> canvas render            (60fps, reads frame buffer)
 *   ThrottledStream -> Zustand store      (10fps, updates React state)
 *   React component -> useStore(selector) (re-renders only on change)
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Subject, throttleTime } from 'rxjs';

// ============================================
// Types
// ============================================

/** Store field definition for schema-driven store creation */
export interface StoreFieldDef<T> {
  /** Field name in the store */
  readonly key: string;
  /** Initial value before any data arrives */
  readonly defaultValue: T;
  /** If set, creates a throttled RxJS stream for this field (milliseconds) */
  readonly throttleMs?: number;
}

/** A throttled stream that rate-limits high-frequency emissions */
export interface ThrottledStream<T> {
  /** Push a value into the stream (called at high frequency) */
  readonly emit: (value: T) => void;
  /** Subscribe to throttled output (called at UI-safe frequency). Returns unsubscribe function. */
  readonly subscribe: (handler: (value: T) => void) => () => void;
}

// ============================================
// Throttled Stream Factory
// ============================================

/**
 * Create a throttled RxJS stream.
 *
 * Use this to bridge high-frequency data (WebSocket messages, animation frames)
 * to UI-safe update rates. The stream drops intermediate values, keeping only
 * the latest value within each throttle window.
 *
 * @param throttleMs - Minimum interval between emissions (e.g., 100 = max 10 updates/sec)
 * @returns Object with emit() to push values and subscribe() to receive throttled values
 *
 * @example
 * ```ts
 * const priceStream = createThrottledStream<number>(100);
 *
 * // In WebSocket handler (called 100x/sec):
 * ws.onmessage = (msg) => {
 *   priceStream.emit(JSON.parse(msg.data).price);
 * };
 *
 * // In React component or store wiring (receives ~10x/sec):
 * priceStream.subscribe((price) => {
 *   useStore.setState({ currentPrice: price });
 * });
 * ```
 */
export function createThrottledStream<T>(throttleMs: number): ThrottledStream<T> {
  const subject = new Subject<T>();
  const throttled = subject.pipe(throttleTime(throttleMs));

  return {
    emit: (value: T) => subject.next(value),
    subscribe: (handler: (value: T) => void) => {
      const sub = throttled.subscribe(handler);
      return () => sub.unsubscribe();
    },
  };
}

// ============================================
// Realtime Store Factory
// ============================================

/**
 * Create a Zustand store with subscribeWithSelector middleware.
 *
 * subscribeWithSelector enables fine-grained subscriptions:
 *   useStore(state => state.price)  -- only re-renders when price changes
 *
 * Without it, every store update triggers all subscribed components.
 * For real-time apps with multiple fields updating at different rates,
 * this is essential.
 *
 * @param initialState - Default state values
 * @param actions - Named action handlers that can update the store
 * @returns Object containing the useStore hook
 *
 * @example
 * ```ts
 * interface AppState {
 *   currentValue: number;
 *   score: number;
 *   isConnected: boolean;
 * }
 *
 * const { useStore } = createRealtimeStore<AppState>(
 *   {
 *     currentValue: 0,
 *     score: 0,
 *     isConnected: false,
 *   },
 *   {
 *     updateValue: (set, _get, payload) => {
 *       const value = payload as number;
 *       set({ currentValue: value });
 *     },
 *     updateConnection: (set, _get, payload) => {
 *       const connected = payload as boolean;
 *       set({ isConnected: connected });
 *     },
 *   },
 * );
 *
 * // In a component:
 * function ValueDisplay() {
 *   const value = useStore(s => s.currentValue);
 *   return <div>{value}</div>;
 * }
 * ```
 */
export function createRealtimeStore<State extends Record<string, unknown>>(
  initialState: State,
  actions: Record<
    string,
    (set: (partial: Partial<State>) => void, get: () => State, payload: unknown) => void
  >,
) {
  type ActionFns = Record<string, (payload: unknown) => void>;

  const useStore = create<State & ActionFns>()(
    subscribeWithSelector((set, get) => {
      const actionFns: ActionFns = {};
      for (const [key, handler] of Object.entries(actions)) {
        actionFns[key] = (payload: unknown) =>
          handler(set as (partial: Partial<State>) => void, get as () => State, payload);
      }
      return { ...initialState, ...actionFns } as State & ActionFns;
    }),
  );

  return { useStore };
}

// ============================================
// Module-Level State
// ============================================

/**
 * Create module-level state for 60fps data that bypasses React.
 *
 * React refs are per-component-instance. Module-level state is shared
 * across all renders and accessible from animation loops without
 * any React overhead (no hooks, no re-renders, no reconciliation).
 *
 * In the full framework, the WASM engine replaces most uses of this pattern --
 * the engine IS the module-level state. This function is provided for
 * cases where you need JS-side state alongside the engine:
 *   - Canvas context references
 *   - Chart library instances
 *   - WebSocket connection objects
 *   - Animation frame IDs
 *
 * @param initial - Initial state object (shallow-copied)
 * @returns A mutable state object. Mutate properties directly -- no setState needed.
 *
 * @example
 * ```ts
 * // At module top level (outside any component):
 * const renderState = createModuleState({
 *   canvas: null as HTMLCanvasElement | null,
 *   ctx: null as CanvasRenderingContext2D | null,
 *   rafId: 0,
 *   lastFrameTime: 0,
 * });
 *
 * // In animation loop (no React involvement):
 * function animate(now: number) {
 *   renderState.lastFrameTime = now;
 *   if (renderState.ctx) {
 *     renderState.ctx.clearRect(0, 0, 800, 600);
 *     // ... render frame ...
 *   }
 *   renderState.rafId = requestAnimationFrame(animate);
 * }
 *
 * // In React component (one-time setup):
 * function Canvas() {
 *   const ref = useCallback((el: HTMLCanvasElement | null) => {
 *     renderState.canvas = el;
 *     renderState.ctx = el?.getContext('2d') ?? null;
 *   }, []);
 *   return <canvas ref={ref} />;
 * }
 * ```
 */
export function createModuleState<T extends Record<string, unknown>>(initial: T): T {
  return { ...initial };
}
