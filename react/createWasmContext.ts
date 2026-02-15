/**
 * createWasmContext — Factory for sharing a WASM engine + notifier across
 * a component tree without prop drilling.
 *
 * Creates a typed Provider component and companion hooks. The engine and
 * notifier are set once at the root and read from any descendant.
 *
 * Usage:
 *   // context.ts — create once per engine type
 *   import { createWasmContext } from 'org-asm/react';
 *   export const { WasmProvider, useEngine, useNotifier } = createWasmContext<MyEngine>();
 *
 *   // App.tsx — wrap at root
 *   const engine = useMemo(() => new MyEngine(), []);
 *   const notifier = useMemo(() => createNotifier(), []);
 *   <WasmProvider engine={engine} notifier={notifier}>
 *     <Dashboard />
 *   </WasmProvider>
 *
 *   // Any descendant — zero prop drilling
 *   const engine = useEngine();
 *   const balance = useWasmState(useNotifier(), () => engine.balance());
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import type { WasmNotifier } from './useWasmState';

export interface WasmProviderProps<E> {
  engine: E;
  notifier: WasmNotifier;
  children: ReactNode;
}

export interface WasmContextValue<E> {
  /** Access the WASM engine from any descendant. Throws if used outside WasmProvider. */
  useEngine: () => E;
  /** Access the notifier from any descendant. Throws if used outside WasmProvider. */
  useNotifier: () => WasmNotifier;
  /** Provider component — wrap at the root of your app or subtree. */
  WasmProvider: (props: WasmProviderProps<E>) => ReactNode;
}

/**
 * Create a typed context for sharing a WASM engine + notifier.
 *
 * Call once per engine type (at module level). Returns a Provider component
 * and two hooks for reading engine/notifier from any descendant.
 */
export function createWasmContext<E>(): WasmContextValue<E> {
  const EngineCtx = createContext<E | null>(null);
  const NotifierCtx = createContext<WasmNotifier | null>(null);

  function useEngine(): E {
    const ctx = useContext(EngineCtx);
    if (ctx === null) {
      throw new Error('useEngine must be used within a WasmProvider');
    }
    return ctx;
  }

  function useNotifier(): WasmNotifier {
    const ctx = useContext(NotifierCtx);
    if (ctx === null) {
      throw new Error('useNotifier must be used within a WasmProvider');
    }
    return ctx;
  }

  function WasmProvider({ engine, notifier, children }: WasmProviderProps<E>): ReactNode {
    return createElement(
      EngineCtx.Provider,
      { value: engine },
      createElement(NotifierCtx.Provider, { value: notifier }, children),
    );
  }

  return { WasmProvider, useEngine, useNotifier };
}
