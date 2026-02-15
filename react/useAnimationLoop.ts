/**
 * useAnimationLoop — Create and manage an AnimationLoop tied to a WASM engine.
 *
 * Bridges the WASM engine's tick/frame_ptr/frame_len interface to the
 * AnimationLoop via a flatBufferTickAdapter. Returns null until both the
 * engine and memory are available. Starts the loop on creation and stops
 * it on cleanup.
 *
 * Usage:
 *   import { Frame } from './generated/frame';
 *   import { ByteBuffer } from 'flatbuffers';
 *
 *   const loop = useAnimationLoop(
 *     engine,
 *     memory,
 *     bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)),
 *   );
 *   // loop is null until engine + memory are ready
 *   // loop starts automatically and stops on unmount
 */

import { useState, useEffect } from 'react';
import { AnimationLoop } from '../view';
import { flatBufferTickAdapter } from '../core';

interface FlatBufferEngine {
  tick(nowMs: number): void;
  frame_ptr(): number;
  frame_len(): number;
}

export function useAnimationLoop<F>(
  engine: FlatBufferEngine | null,
  memory: WebAssembly.Memory | null,
  rootFn: (bytes: Uint8Array) => F,
): AnimationLoop<F> | null {
  const [loop, setLoop] = useState<AnimationLoop<F> | null>(null);

  useEffect(() => {
    if (!engine || !memory) return;

    const adapted = flatBufferTickAdapter(engine, memory, rootFn);
    const animationLoop = new AnimationLoop(adapted);
    animationLoop.start();
    setLoop(animationLoop);

    return () => {
      animationLoop.stop();
      setLoop(null);
    };
    // rootFn is intentionally omitted — callers should memoize or define
    // it outside render. Re-creating the loop on every rootFn change would
    // tear down and restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, memory]);

  return loop;
}
