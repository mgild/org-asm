/**
 * useAsyncWasmCall — Async WASM calls with loading/result/error state.
 *
 * For functions returning Promises: wasm-bindgen-futures (Rust async fn
 * that calls JS async APIs) or worker offload via WasmTaskWorker.
 * Cancellation via stale flag on deps change (latest-wins).
 *
 * Usage:
 *   // wasm-bindgen-futures: Rust async fn -> JS Promise
 *   const { result, loading, error } = useAsyncWasmCall(
 *     () => engine.fetch_and_process(url),
 *     [url],
 *   );
 *
 *   // Worker offload
 *   const worker = useMemo(() => new WasmTaskWorker(config), []);
 *   const { result, loading, error } = useAsyncWasmCall(
 *     () => worker.call('optimize_portfolio', { holdings }),
 *     [holdings],
 *   );
 */

import { useState, useEffect, useRef } from 'react';

export interface AsyncWasmCallResult<T> {
  readonly result: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

export function useAsyncWasmCall<T>(
  fn: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncWasmCallResult<T> {
  const [result, setResult] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fnRef.current().then(
      (value) => {
        if (!stale) {
          setResult(value);
          setLoading(false);
        }
      },
      (err) => {
        if (!stale) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      },
    );

    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { result, loading, error };
}
