/**
 * useWasmReducer — Rust-first state management for non-animation apps.
 *
 * Like React's useReducer, but the reducer logic lives in your WASM engine.
 * Dispatch an action → engine processes it → React re-renders with new snapshot.
 * No tick loop needed. The engine owns all state and transition logic.
 *
 * Usage:
 *   const [state, dispatch] = useWasmReducer(engine, {
 *     getSnapshot: (e) => ({
 *       items: e.get_items(),
 *       total: e.total(),
 *       isValid: e.is_valid(),
 *     }),
 *     dispatch: (e, action) => {
 *       switch (action.type) {
 *         case 'add': e.add_item(action.name, action.price); break;
 *         case 'remove': e.remove_item(action.id); break;
 *         case 'clear': e.clear_all(); break;
 *       }
 *     },
 *   });
 *
 *   // Dispatch triggers engine mutation + React re-render
 *   dispatch({ type: 'add', name: 'Widget', price: 9.99 });
 *
 * For async dispatches (engine methods returning Promises):
 *   const [state, dispatch] = useWasmReducer(engine, {
 *     getSnapshot: (e) => ({ result: e.result(), loading: e.is_loading() }),
 *     dispatch: async (e, action) => {
 *       if (action.type === 'fetch') await e.fetch_data(action.url);
 *     },
 *   });
 */

import { useRef, useCallback, useSyncExternalStore } from 'react';

export interface WasmReducerConfig<E, S, A> {
  /** Extract a snapshot from the engine. Called on every subscribe notification. */
  getSnapshot: (engine: E) => S;
  /** Apply an action to the engine. May be sync or async. */
  dispatch: (engine: E, action: A) => void | Promise<void>;
}

export function useWasmReducer<E, S, A>(
  engine: E,
  config: WasmReducerConfig<E, S, A>,
): [S, (action: A) => void] {
  const configRef = useRef(config);
  configRef.current = config;

  // Minimal inline notifier — no need for createNotifier() dependency
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);

  const getSnapshot = useCallback(
    () => configRef.current.getSnapshot(engine),
    [engine],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dispatch = useCallback(
    (action: A) => {
      const result = configRef.current.dispatch(engine, action);
      if (result && typeof result === 'object' && 'then' in result) {
        (result as Promise<void>).then(
          () => { for (const cb of listenersRef.current) cb(); },
          () => { for (const cb of listenersRef.current) cb(); },
        );
      } else {
        for (const cb of listenersRef.current) cb();
      }
    },
    [engine],
  );

  return [state, dispatch];
}
