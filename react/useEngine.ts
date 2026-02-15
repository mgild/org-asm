/**
 * useEngine — Register an engine on a MultiAnimationLoop.
 *
 * Two calling conventions:
 *
 *   1. Raw tick source (any { tick(nowMs): F }):
 *      const handle = useEngine(loop, myTickSource);
 *
 *   2. FlatBuffer WASM engine (mirrors useAnimationLoop):
 *      const handle = useEngine(loop, engine, memory, rootFn);
 *
 * Returns an EngineHandle<F> that works as a drop-in for AnimationLoop
 * with useFrame() and other consumer hooks. The engine is removed from
 * the shared loop on unmount.
 *
 * The loop is created externally — pass the same instance to multiple
 * useEngine calls to share a single requestAnimationFrame:
 *
 *   // Create once, share everywhere
 *   const loop = useMemo(() => new MultiAnimationLoop(), []);
 *
 *   // Or create at module scope / in context
 *   const loop = useContext(AnimationLoopContext);
 *
 *   const obHandle = useEngine(loop, obEngine, obMemory, parseOb);
 *   const chartHandle = useEngine(loop, chartEngine, chartMemory, parseChart);
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { flatBufferTickAdapter } from '../core';
import type { MultiAnimationLoop, EngineHandle } from '../view/MultiAnimationLoop';

interface FlatBufferEngine {
  tick(nowMs: number): void;
  frame_ptr(): number;
  frame_len(): number;
}

/** Register a raw tick source on a shared loop. */
export function useEngine<F>(
  loop: MultiAnimationLoop,
  tickSource: { tick(nowMs: number): F } | null,
): EngineHandle<F> | null;

/** Register a FlatBuffer WASM engine on a shared loop. */
export function useEngine<F>(
  loop: MultiAnimationLoop,
  engine: FlatBufferEngine | null,
  memory: WebAssembly.Memory | null,
  rootFn: (bytes: Uint8Array) => F,
): EngineHandle<F> | null;

export function useEngine<F>(
  loop: MultiAnimationLoop,
  engineOrTick: FlatBufferEngine | { tick(nowMs: number): F } | null,
  memory?: WebAssembly.Memory | null,
  rootFn?: (bytes: Uint8Array) => F,
): EngineHandle<F> | null {
  const rootFnRef = useRef(rootFn);
  rootFnRef.current = rootFn;

  const tickSource = useMemo(() => {
    if (!engineOrTick) return null;
    if (memory != null && rootFnRef.current != null) {
      return flatBufferTickAdapter(engineOrTick as FlatBufferEngine, memory, rootFnRef.current);
    }
    return engineOrTick as { tick(nowMs: number): F };
    // rootFn intentionally omitted — callers should memoize or define
    // it outside render. Re-creating the adapter on every rootFn change would
    // tear down and re-register the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOrTick, memory]);

  const [handle, setHandle] = useState<EngineHandle<F> | null>(null);

  useEffect(() => {
    if (!tickSource) return;

    const h = loop.addEngine(tickSource);
    loop.start();
    setHandle(h);

    return () => {
      h.remove();
      setHandle(null);
    };
  }, [loop, tickSource]);

  return handle;
}
