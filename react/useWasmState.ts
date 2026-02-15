/**
 * useWasmState — Reactive WASM state via useSyncExternalStore.
 *
 * When external events mutate engine state (WebSocket data, user actions),
 * call `notifier.notify()`. All subscribers re-read their snapshots.
 *
 * Usage:
 *   const notifier = useMemo(() => createNotifier(), []);
 *   pipeline.onMessage(raw => { engine.ingest_message(raw); notifier.notify(); });
 *
 *   const balance = useWasmState(notifier, () => engine.balance());
 *   const count = useWasmState(notifier, () => engine.order_count());
 */

import { useSyncExternalStore } from 'react';

/** Minimal pub/sub interface for notifying React of WASM state changes. */
export interface WasmNotifier {
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(callback: () => void): () => void;
  /** Notify all subscribers that state has changed. */
  notify(): void;
  /**
   * Batch multiple mutations into a single notification.
   * Calls inside the batch run synchronously; subscribers are notified
   * once at the end, regardless of how many times notify() was called.
   *
   * Usage:
   *   notifier.batch(() => {
   *     for (const msg of messages) {
   *       engine.ingest(msg);
   *       notifier.notify(); // suppressed during batch
   *     }
   *   }); // single notify fires here
   */
  batch(fn: () => void): void;
}

/** Create a minimal pub/sub notifier for WASM state changes. */
export function createNotifier(): WasmNotifier {
  const listeners = new Set<() => void>();
  let batching = false;
  let batchDirty = false;

  function fire(): void {
    for (const cb of listeners) cb();
  }

  return {
    subscribe(callback: () => void): () => void {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
    notify(): void {
      if (batching) {
        batchDirty = true;
        return;
      }
      fire();
    },
    batch(fn: () => void): void {
      batching = true;
      batchDirty = false;
      try {
        fn();
      } finally {
        batching = false;
        if (batchDirty) {
          batchDirty = false;
          fire();
        }
      }
    },
  };
}

/**
 * Subscribe to WASM state via useSyncExternalStore.
 * Re-reads `getSnapshot` only when `notifier.notify()` is called.
 */
export function useWasmState<T>(
  notifier: WasmNotifier,
  getSnapshot: () => T,
): T {
  return useSyncExternalStore(notifier.subscribe, getSnapshot, getSnapshot);
}
