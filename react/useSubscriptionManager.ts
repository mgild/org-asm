/**
 * useSubscriptionManager — Create a SubscriptionManager tied to a pipeline.
 *
 * Creates the manager once when the pipeline appears. The manager
 * auto-replays subscriptions on reconnect.
 *
 * Usage:
 *   const ws = useMemo(() => new WebSocketPipeline({ url: 'wss://...' }), []);
 *   const { connected } = useConnection(ws);
 *   const subs = useSubscriptionManager(ws);
 *
 *   // Subscribe (replays automatically on reconnect)
 *   subs?.add('BTC-USD', () => commands.subscribe({ symbol: 'BTC-USD' }));
 *
 *   // Unsubscribe
 *   subs?.remove('BTC-USD');
 *   commands.unsubscribe({ symbol: 'BTC-USD' });
 */

import { useRef } from 'react';
import { SubscriptionManager } from '../controller/SubscriptionManager';
import type { WebSocketPipeline } from '../controller';

export function useSubscriptionManager(
  pipeline: WebSocketPipeline | null,
): SubscriptionManager | null {
  const ref = useRef<SubscriptionManager | null>(null);

  if (pipeline && !ref.current) {
    ref.current = new SubscriptionManager(pipeline);
  }
  if (!pipeline) {
    ref.current = null;
  }

  return ref.current;
}
