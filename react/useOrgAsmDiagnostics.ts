/**
 * useOrgAsmDiagnostics — Poll pipeline and registry for diagnostics data.
 *
 * Returns a reactive diagnostics object updated at ~2Hz.
 * Use with OrgAsmDevTools for a pre-built UI, or build your own.
 */

import { useState, useEffect, useRef } from 'react';
import { ConnectionState } from '../controller';

interface DiagnosticsSource {
  /** WebSocketPipeline or any IConnectionPipeline */
  pipeline?: {
    readonly state: ConnectionState;
    readonly stale: boolean;
    readonly messageCount?: number;
    readonly binaryMessageCount?: number;
  } | null;
  /** ResponseRegistry */
  registry?: { readonly pendingCount: number } | null;
}

export interface DiagnosticsData {
  connectionState: ConnectionState;
  stale: boolean;
  messageRate: number;
  binaryMessageRate: number;
  pendingCommands: number;
}

const POLL_MS = 500;

export function useOrgAsmDiagnostics(sources: DiagnosticsSource): DiagnosticsData {
  const [data, setData] = useState<DiagnosticsData>({
    connectionState: ConnectionState.Disconnected,
    stale: false,
    messageRate: 0,
    binaryMessageRate: 0,
    pendingCommands: 0,
  });

  const prevRef = useRef({ messageCount: 0, binaryMessageCount: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      const pipeline = sources.pipeline;
      const registry = sources.registry;

      const msgCount = (pipeline as { messageCount?: number } | null | undefined)?.messageCount ?? 0;
      const binCount = (pipeline as { binaryMessageCount?: number } | null | undefined)?.binaryMessageCount ?? 0;

      const msgDelta = msgCount - prevRef.current.messageCount;
      const binDelta = binCount - prevRef.current.binaryMessageCount;
      prevRef.current = { messageCount: msgCount, binaryMessageCount: binCount };

      const rateMultiplier = 1000 / POLL_MS;

      setData({
        connectionState: pipeline?.state ?? ConnectionState.Disconnected,
        stale: pipeline?.stale ?? false,
        messageRate: Math.round(msgDelta * rateMultiplier * 10) / 10,
        binaryMessageRate: Math.round(binDelta * rateMultiplier * 10) / 10,
        pendingCommands: registry?.pendingCount ?? 0,
      });
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [sources.pipeline, sources.registry]);

  return data;
}
