/**
 * useDebouncedWasmCall — Debounced synchronous WASM calls.
 *
 * Like useWasmCall but waits for a quiet period before calling the engine.
 * Returns null until the first debounced call completes. Ideal for
 * search, autocomplete, and filter-as-you-type backed by WASM.
 *
 * Usage:
 *   const results = useDebouncedWasmCall(
 *     () => engine.search(query),
 *     [query],
 *     200,  // 200ms debounce
 *   );
 *
 *   const suggestions = useDebouncedWasmCall(
 *     () => engine.autocomplete(input, 10),
 *     [input],
 *     150,
 *   );
 */

import { useState, useEffect, useRef } from 'react';

export function useDebouncedWasmCall<T>(
  fn: () => T,
  deps: ReadonlyArray<unknown>,
  delayMs: number,
): T | null {
  const [value, setValue] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setValue(fnRef.current());
    }, delayMs);

    return () => {
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);

  return value;
}
