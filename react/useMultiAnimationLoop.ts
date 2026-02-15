/**
 * useMultiAnimationLoop — Create and manage a shared MultiAnimationLoop.
 *
 * Returns a stable MultiAnimationLoop instance that persists across renders.
 * The loop starts on mount and stops on unmount. Pass it to useEngine() to
 * register individual engines that share a single requestAnimationFrame.
 *
 * Usage:
 *   const sharedLoop = useMultiAnimationLoop();
 *
 *   const obHandle = useEngine(sharedLoop, obTickSource);
 *   const chartHandle = useEngine(sharedLoop, chartTickSource);
 *
 *   const bid = useFrame(obHandle, f => f.bestBid());
 *   const price = useFrame(chartHandle, f => f.price());
 */

import { useRef, useEffect } from 'react';
import { MultiAnimationLoop } from '../view/MultiAnimationLoop';

export function useMultiAnimationLoop(): MultiAnimationLoop {
  const ref = useRef<MultiAnimationLoop | null>(null);
  if (!ref.current) {
    ref.current = new MultiAnimationLoop();
  }

  useEffect(() => {
    const loop = ref.current!;
    loop.start();
    return () => loop.stop();
  }, []);

  return ref.current;
}
