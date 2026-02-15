/**
 * useWasmStream — Streaming/chunked results from WASM.
 *
 * For long computations that yield results incrementally. The WASM side
 * calls an `emit` callback for each chunk. The hook accumulates chunks
 * and triggers React updates.
 *
 * Usage:
 *   const { chunks, done, error } = useWasmStream(
 *     (emit) => engine.process_large_dataset(data, emit),
 *     [data],
 *   );
 *
 *   // Async (worker-based):
 *   const { chunks, done, error } = useWasmStream(
 *     (emit) => worker.stream('analyze', { dataset }, emit),
 *     [dataset],
 *   );
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface WasmStreamResult<T> {
  readonly chunks: readonly T[];
  readonly done: boolean;
  readonly error: Error | null;
}

export function useWasmStream<T>(
  fn: (emit: (chunk: T) => void) => void | Promise<void>,
  deps: ReadonlyArray<unknown>,
): WasmStreamResult<T> {
  const [chunks, setChunks] = useState<readonly T[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Mutable accumulator to batch micro-task updates
  const accRef = useRef<T[]>([]);
  const rafRef = useRef(0);

  const flush = useCallback(() => {
    rafRef.current = 0;
    const pending = accRef.current;
    accRef.current = [];
    setChunks(prev => [...prev, ...pending]);
  }, []);

  useEffect(() => {
    let stale = false;
    accRef.current = [];
    setChunks([]);
    setDone(false);
    setError(null);

    const emit = (chunk: T): void => {
      if (stale) return;
      accRef.current.push(chunk);
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    try {
      const maybePromise = fnRef.current(emit);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          () => {
            if (!stale) {
              // Flush remaining chunks
              if (accRef.current.length > 0) flush();
              setDone(true);
            }
          },
          (err) => {
            if (!stale) {
              if (accRef.current.length > 0) flush();
              setError(err instanceof Error ? err : new Error(String(err)));
              setDone(true);
            }
          },
        );
      } else {
        // Synchronous stream completed (stale is always false here)
        if (accRef.current.length > 0) flush();
        setDone(true);
      }
    } catch (err) {
      // Synchronous throw (stale is always false here)
      setError(err instanceof Error ? err : new Error(String(err)));
      setDone(true);
    }

    return () => {
      stale = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { chunks, done, error };
}
