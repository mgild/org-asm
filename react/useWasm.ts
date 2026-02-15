/**
 * useWasm — Initialize a WASM module and track its ready state.
 *
 * Calls the provided init function once on mount and exposes the
 * resulting WebAssembly.Memory along with loading/error state.
 *
 * Usage:
 *   import init from './pkg/my_engine';
 *
 *   const { memory, ready, error } = useWasm(() => init());
 *   // `memory` is null until WASM is loaded
 *   // `ready` flips to true once init resolves
 *   // `error` captures any init failure
 */

import { useState, useEffect, useRef } from 'react';

interface WasmResult {
  memory: WebAssembly.Memory | null;
  ready: boolean;
  error: Error | null;
}

export function useWasm(
  initFn: () => Promise<{ memory: WebAssembly.Memory }>,
): WasmResult {
  const [memory, setMemory] = useState<WebAssembly.Memory | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const initRef = useRef(initFn);

  useEffect(() => {
    let cancelled = false;

    initRef.current()
      .then((result) => {
        if (!cancelled) {
          setMemory(result.memory);
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { memory, ready, error };
}
