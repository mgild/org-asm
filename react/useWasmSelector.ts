/**
 * useWasmSelector — Reactive WASM state with structural equality.
 *
 * Like useWasmState, but prevents re-renders when the selected object
 * hasn't structurally changed. Essential when getSnapshot returns objects
 * (which fail === equality on every call).
 *
 * Default comparator: shallow equality (compares own enumerable keys).
 * Pass a custom `isEqual` for deep or domain-specific comparison.
 *
 * Usage:
 *   // Without selector: re-renders on EVERY notify (new object each time)
 *   const book = useWasmState(notifier, () => ({ bid: engine.bid(), ask: engine.ask() }));
 *
 *   // With selector: skips re-render when bid and ask haven't changed
 *   const book = useWasmSelector(notifier, () => ({ bid: engine.bid(), ask: engine.ask() }));
 *
 *   // Custom equality:
 *   const prices = useWasmSelector(
 *     notifier,
 *     () => engine.get_price_levels(),
 *     (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
 *   );
 */

import { useRef, useCallback, useSyncExternalStore } from 'react';

/** Shallow equality: compares own enumerable keys by === */
function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

export function useWasmSelector<T>(
  notifier: { subscribe(cb: () => void): () => void },
  getSnapshot: () => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  const prevRef = useRef<{ value: T; initialized: boolean }>({ value: undefined as T, initialized: false });
  const snapshotRef = useRef(getSnapshot);
  snapshotRef.current = getSnapshot;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const memoizedGetSnapshot = useCallback(() => {
    const next = snapshotRef.current();
    if (prevRef.current.initialized && isEqualRef.current(prevRef.current.value, next)) {
      return prevRef.current.value;
    }
    prevRef.current = { value: next, initialized: true };
    return next;
  }, []);

  return useSyncExternalStore(notifier.subscribe, memoizedGetSnapshot, memoizedGetSnapshot);
}
