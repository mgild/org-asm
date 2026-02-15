/**
 * useResponseRegistry — Wire a ResponseRegistry onto a WebSocketPipeline.
 *
 * Creates a ResponseRegistry, intercepts binary messages (trying the registry
 * first, falling through to `onMessage` for non-response frames), and
 * rejects all pending promises on disconnect or unmount.
 *
 * Usage:
 *   const ws = useMemo(() => new WebSocketPipeline({ url: 'wss://...' }), []);
 *   const { connected } = useConnection(ws);
 *   const registry = useResponseRegistry(ws, extractId, {
 *     onMessage: (data) => parser.ingestFrame(data),
 *   });
 *   const commands = useCommands(ws, registry);
 *
 *   const response = await commands.subscribeAsync({ symbol: 'BTC-USD' });
 */

import { useRef, useEffect } from 'react';
import { ResponseRegistry } from '../controller';
import type { WebSocketPipeline } from '../controller';

export function useResponseRegistry(
  pipeline: WebSocketPipeline | null,
  extractId: (data: ArrayBuffer) => bigint | null,
  options?: {
    timeoutMs?: number;
    onMessage?: (data: ArrayBuffer) => void;
  },
): ResponseRegistry | null {
  const registryRef = useRef<ResponseRegistry | null>(null);
  const onMessageRef = useRef(options?.onMessage);
  onMessageRef.current = options?.onMessage;

  if (pipeline && !registryRef.current) {
    registryRef.current = new ResponseRegistry(extractId, options?.timeoutMs);
  }
  if (!pipeline) {
    registryRef.current = null;
  }

  const registry = registryRef.current;

  useEffect(() => {
    if (!pipeline || !registry) return;

    pipeline.onBinaryMessage((data) => {
      if (!registry.handleMessage(data)) {
        onMessageRef.current?.(data);
      }
    });

    pipeline.onDisconnect(() => {
      registry.rejectAll('Connection lost');
    });

    return () => {
      registry.rejectAll('Hook cleanup');
    };
  }, [pipeline, registry]);

  return registry;
}
