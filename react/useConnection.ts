/**
 * useConnection — Create a WebSocketPipeline and track connection state.
 *
 * Instantiates a WebSocketPipeline from the provided config, connects
 * on mount, and disconnects on cleanup. Exposes the pipeline instance
 * for attaching message handlers and the current connected state for
 * conditional rendering.
 *
 * Usage:
 *   const { pipeline, connected } = useConnection({
 *     url: 'wss://stream.example.com/ws',
 *     reconnectDelayMs: 5000,
 *   });
 *
 *   useEffect(() => {
 *     pipeline.onMessage(raw => engine.ingest_message(raw, Date.now()));
 *   }, [pipeline, engine]);
 *
 *   return <span>{connected ? 'Live' : 'Reconnecting...'}</span>;
 */

import { useState, useEffect, useRef } from 'react';
import { WebSocketPipeline } from '../controller';
import type { WebSocketConfig } from '../controller';

interface ConnectionResult {
  pipeline: WebSocketPipeline;
  connected: boolean;
}

export function useConnection(config: WebSocketConfig): ConnectionResult {
  const [connected, setConnected] = useState(false);
  const pipelineRef = useRef<WebSocketPipeline | null>(null);

  // Lazily create the pipeline so the ref is stable across renders
  if (!pipelineRef.current) {
    pipelineRef.current = new WebSocketPipeline(config);
  }

  const pipeline = pipelineRef.current;

  useEffect(() => {
    pipeline.onConnect(() => setConnected(true));
    pipeline.onDisconnect(() => setConnected(false));
    pipeline.connect();

    return () => {
      pipeline.disconnect();
      setConnected(false);
    };
  }, [pipeline]);

  return { pipeline, connected };
}
