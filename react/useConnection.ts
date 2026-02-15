/**
 * useConnection — Create a WebSocketPipeline and track connection state.
 *
 * Instantiates a WebSocketPipeline from the provided config, connects
 * on mount, and disconnects on cleanup. Exposes the pipeline instance
 * for attaching message handlers and the full connection state.
 *
 * Usage:
 *   const { pipeline, connected, state, error, stale } = useConnection({
 *     url: 'wss://stream.example.com/ws',
 *     reconnectDelayMs: 1000,
 *   });
 *
 *   useEffect(() => {
 *     pipeline.onMessage(raw => engine.ingest_message(raw, Date.now()));
 *   }, [pipeline, engine]);
 *
 *   return <span>{connected ? 'Live' : stale ? 'Stale' : 'Reconnecting...'}</span>;
 */

import { useState, useEffect, useRef } from 'react';
import { WebSocketPipeline, ConnectionState } from '../controller';
import type { WebSocketConfig, ConnectionError } from '../controller';

interface ConnectionResult {
  pipeline: WebSocketPipeline;
  connected: boolean;
  state: ConnectionState;
  error: ConnectionError | null;
  stale: boolean;
}

export function useConnection(config: WebSocketConfig): ConnectionResult {
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState<ConnectionError | null>(null);
  const [stale, setStale] = useState(false);
  const pipelineRef = useRef<WebSocketPipeline | null>(null);

  // Lazily create the pipeline so the ref is stable across renders
  if (!pipelineRef.current) {
    pipelineRef.current = new WebSocketPipeline(config);
  }

  const pipeline = pipelineRef.current;

  useEffect(() => {
    // Use onStateChange for tracking — leaves onConnect/onDisconnect free for user code
    pipeline.onStateChange((newState) => {
      setState(newState);
      // Clear error on successful reconnect
      if (newState === ConnectionState.Connected) {
        setError(null);
      }
    });

    pipeline.onError((err) => setError(err));

    pipeline.connect();

    // Poll staleness every 1s
    const staleInterval = setInterval(() => {
      setStale(pipeline.stale);
    }, 1000);

    return () => {
      clearInterval(staleInterval);
      pipeline.disconnect();
      setState(ConnectionState.Disconnected);
      setStale(false);
    };
  }, [pipeline]);

  return {
    pipeline,
    connected: state === ConnectionState.Connected,
    state,
    error,
    stale,
  };
}
