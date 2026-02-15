/**
 * SubscriptionManager — Track active subscriptions and replay on reconnect.
 *
 * Stores replay functions keyed by a user-provided string key. On reconnect,
 * all active subscriptions are replayed automatically.
 *
 * ## Usage
 *
 * ```ts
 * const subs = new SubscriptionManager(pipeline);
 *
 * // Subscribe (tracked for automatic replay on reconnect)
 * subs.add('BTC-USD', () => commands.subscribe({ symbol: 'BTC-USD', depth: 20 }));
 * subs.add('ETH-USD', () => commands.subscribe({ symbol: 'ETH-USD' }));
 *
 * // Unsubscribe (remove from replay list)
 * subs.remove('BTC-USD');
 * commands.unsubscribe({ symbol: 'BTC-USD' });
 *
 * // On reconnect, all remaining subscriptions replay automatically
 * ```
 */

import type { WebSocketPipeline } from './WebSocketPipeline';

export class SubscriptionManager {
  private subscriptions = new Map<string, () => void>();

  /**
   * @param pipeline - WebSocket pipeline to monitor for reconnects.
   *   Uses onConnect (multi-subscriber) to trigger replay.
   */
  constructor(pipeline: WebSocketPipeline) {
    pipeline.onConnect(() => this.replayAll());
  }

  /**
   * Add a subscription and execute the replay function immediately.
   * The replay function will also be called on every reconnect.
   *
   * @param key - Unique key for this subscription (e.g. symbol name)
   * @param replayFn - Function that sends the subscribe command
   */
  add(key: string, replayFn: () => void): void {
    this.subscriptions.set(key, replayFn);
    replayFn();
  }

  /**
   * Remove a subscription from the replay list.
   * Does NOT send an unsubscribe command — caller should do that separately.
   */
  remove(key: string): void {
    this.subscriptions.delete(key);
  }

  /** Check if a subscription key is active */
  has(key: string): boolean {
    return this.subscriptions.has(key);
  }

  /** Replace the replay function for an existing key without re-executing */
  update(key: string, replayFn: () => void): void {
    if (this.subscriptions.has(key)) {
      this.subscriptions.set(key, replayFn);
    }
  }

  /** Remove all subscriptions */
  clear(): void {
    this.subscriptions.clear();
  }

  /** Replay all active subscriptions (called automatically on reconnect) */
  replayAll(): void {
    for (const [, fn] of this.subscriptions) {
      fn();
    }
  }

  /** Number of active subscriptions */
  get size(): number {
    return this.subscriptions.size;
  }

  /** All active subscription keys */
  get keys(): string[] {
    return [...this.subscriptions.keys()];
  }
}
