/**
 * useWasmCall — Synchronous on-demand WASM calls.
 *
 * `useMemo` for WASM. Calls a synchronous engine method when deps change.
 * No loading state — wasm-bindgen calls are synchronous. The name signals
 * "WASM boundary crossing" and makes the call site greppable.
 *
 * Usage:
 *   const isValid = useWasmCall(() => engine.validate(input), [input]);
 *   const formatted = useWasmCall(() => engine.format_amount(value, 2), [value]);
 */

import { useMemo } from 'react';

export function useWasmCall<T>(fn: () => T, deps: ReadonlyArray<unknown>): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, deps);
}
