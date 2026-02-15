/**
 * useResponseRegistry — Wire a ResponseRegistry onto a WebSocketPipeline.
 *
 * Creates a ResponseRegistry, installs binary middleware (trying the registry
 * first, falling through to the next handler for non-response frames), and
 * rejects all pending promises on disconnect or unmount.
 *
 * Usage:
 *   const ws = useMemo(() => new WebSocketPipeline({ url: 'wss://...' }), []);
 *   const { connected } = useConnection(ws);
 *   const registry = useResponseRegistry(ws, extractId, {
 *     timeoutMs: 5000,
 *     deserialize: parseMyResponse,
 *   });
 *   const commands = useCommands(ws, registry);
 *
 *   const response = await commands.subscribeAsync({ symbol: 'BTC-USD' });
 */

import { useRef, useEffect } from 'react';
import { ResponseRegistry } from '../controller';
import type { WebSocketPipeline } from '../controller';

export function useResponseRegistry<R = ArrayBuffer>(
  pipeline: WebSocketPipeline | null,
  extractId: (data: ArrayBuffer) => bigint | null,
  options?: {
    timeoutMs?: number;
    deserialize?: (data: ArrayBuffer) => R;
  },
): ResponseRegistry<R> | null {
  const registryRef = useRef<ResponseRegistry<R> | null>(null);

  if (pipeline && !registryRef.current) {
    registryRef.current = new ResponseRegistry<R>(
      extractId,
      options?.timeoutMs,
      options?.deserialize,
    );
  }
  if (!pipeline) {
    registryRef.current = null;
  }

  const registry = registryRef.current;

  useEffect(() => {
    if (!pipeline || !registry) return;

    // Install as middleware — non-response messages pass through to next handler
    const unuse = pipeline.use((data, next) => {
      if (!registry.handleMessage(data)) {
        next();
      }
    });

    pipeline.onDisconnect(() => {
      registry.rejectAll('Connection lost');
    });

    return () => {
      unuse();
      registry.rejectAll('Hook cleanup');
    };
  }, [pipeline, registry]);

  return registry;
}
