/**
 * useConnection — Create or adopt a connection pipeline and track connection state.
 *
 * Two calling conventions:
 *   1. Config object (existing): creates a WebSocketPipeline internally.
 *   2. Pipeline instance (new): adopts any IConnectionPipeline (SSEPipeline, etc.)
 *
 * Both paths expose the same result shape. The pipeline connects on mount
 * and disconnects on cleanup.
 *
 * Usage (config — backward compatible):
 *   const { pipeline, connected, state, error, stale } = useConnection({
 *     url: 'wss://stream.example.com/ws',
 *   });
 *
 * Usage (pipeline instance):
 *   const sse = useMemo(() => new SSEPipeline({ url: '/events' }), []);
 *   const { pipeline, connected, state, error, stale } = useConnection(sse);
 */

import { useState, useEffect, useRef } from 'react';
import { WebSocketPipeline, ConnectionState } from '../controller';
import type { WebSocketConfig, ConnectionError } from '../controller';
import type { IConnectionPipeline } from '../controller/connectionTypes';

interface ConnectionResult {
  pipeline: IConnectionPipeline;
  connected: boolean;
  state: ConnectionState;
  error: ConnectionError | null;
  stale: boolean;
}

/** Detect whether the argument is a pre-built pipeline or a config object */
function isPipeline(arg: WebSocketConfig | IConnectionPipeline): arg is IConnectionPipeline {
  return typeof (arg as IConnectionPipeline).connect === 'function';
}

export function useConnection(config: WebSocketConfig): ConnectionResult;
export function useConnection(pipeline: IConnectionPipeline): ConnectionResult;
export function useConnection(configOrPipeline: WebSocketConfig | IConnectionPipeline): ConnectionResult {
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState<ConnectionError | null>(null);
  const [stale, setStale] = useState(false);
  const pipelineRef = useRef<IConnectionPipeline | null>(null);

  // Lazily create or adopt the pipeline so the ref is stable across renders
  if (!pipelineRef.current) {
    pipelineRef.current = isPipeline(configOrPipeline)
      ? configOrPipeline
      : new WebSocketPipeline(configOrPipeline);
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
