/**
 * useWorker — React hook for off-main-thread WASM computation via Worker.
 *
 * Replaces the useWasm() + useAnimationLoop() combination for the Worker path.
 * Creates a WorkerBridge, initializes it, wires up a SharedBufferTickSource,
 * and creates an AnimationLoop that reads from the SAB.
 *
 * The WASM engine runs entirely in the Worker thread. The main thread only
 * reads the latest frame from SharedArrayBuffer on each rAF tick — zero
 * postMessage overhead for frame data.
 *
 * Usage:
 *   const { loop, bridge, ready, error } = useWorker({
 *     workerUrl: new URL('./my-worker.ts', import.meta.url),
 *     frameSize: 39,
 *     wasmUrl: './pkg/my_engine_bg.wasm',
 *     engineConstructor: 'MyEngine',
 *   });
 *
 *   // Use loop with useFrame() as normal
 *   const intensity = useFrame(loop, f => f[0], 100);
 *
 *   // Send data to the worker
 *   useEffect(() => {
 *     if (!bridge) return;
 *     pipeline.onMessage(raw => bridge.postData(raw));
 *   }, [bridge, pipeline]);
 */

import { useState, useEffect, useRef } from 'react';
import { AnimationLoop } from '../view';
import { WorkerBridge } from '../controller/WorkerBridge';
import type { WorkerBridgeConfig } from '../controller/WorkerBridge';
import { sharedBufferTickSource, sharedBufferFlatBufferTickSource } from '../controller/SharedBufferTickSource';

export interface UseWorkerConfig extends WorkerBridgeConfig {
  /** URL or path to the WASM file */
  wasmUrl: string;
  /** Name of the engine constructor exported from the WASM module */
  engineConstructor: string;
  /** FlatBuffer root deserialization function (if using FlatBuffer mode) */
  rootFn?: (bytes: Uint8Array) => unknown;
}

interface UseWorkerResult<F> {
  /** AnimationLoop reading frames from the SharedArrayBuffer. Null until ready. */
  loop: AnimationLoop<F> | null;
  /** WorkerBridge for sending input/data/configure messages. Null until ready. */
  bridge: WorkerBridge | null;
  /** Whether the worker is initialized and the animation loop is running */
  ready: boolean;
  /** Initialization error, if any */
  error: Error | null;
}

export function useWorker(config: UseWorkerConfig): UseWorkerResult<Float64Array>;
export function useWorker<F>(config: UseWorkerConfig & { rootFn: (bytes: Uint8Array) => F }): UseWorkerResult<F>;
export function useWorker<F = Float64Array>(config: UseWorkerConfig): UseWorkerResult<F> {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loop, setLoop] = useState<AnimationLoop<F> | null>(null);
  const bridgeRef = useRef<WorkerBridge | null>(null);
  const configRef = useRef(config);

  useEffect(() => {
    let cancelled = false;
    const cfg = configRef.current;

    const bridge = new WorkerBridge({
      workerUrl: cfg.workerUrl,
      frameSize: cfg.frameSize,
      frameSizeBytes: cfg.frameSizeBytes,
      tickIntervalMs: cfg.tickIntervalMs,
    });

    bridgeRef.current = bridge;

    bridge
      .initialize(cfg.wasmUrl, cfg.engineConstructor)
      .then(() => {
        if (cancelled) {
          bridge.dispose();
          return;
        }

        // Create tick source based on mode
        let tickSource: { tick(nowMs: number): F };
        if (cfg.rootFn && cfg.frameSizeBytes != null) {
          // FlatBuffer mode
          tickSource = sharedBufferFlatBufferTickSource<F>(
            bridge.buffer,
            cfg.frameSizeBytes,
            cfg.rootFn as (bytes: Uint8Array) => F,
          );
        } else {
          // Float64Array mode
          tickSource = sharedBufferTickSource(bridge.buffer, cfg.frameSize) as unknown as { tick(nowMs: number): F };
        }

        const animationLoop = new AnimationLoop<F>(tickSource);
        bridge.start();
        animationLoop.start();

        setLoop(animationLoop);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
      if (loop) {
        loop.stop();
      }
      bridge.stop();
      bridge.dispose();
      bridgeRef.current = null;
      setLoop(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loop,
    bridge: bridgeRef.current,
    ready,
    error,
  };
}
