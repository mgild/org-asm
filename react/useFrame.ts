/**
 * useFrame — Subscribe to throttled frame updates for React re-renders.
 *
 * Creates an IFrameConsumer that extracts a value from each animation
 * frame and triggers React state updates at a throttled rate. This
 * prevents 60fps re-renders — only the most recent frame value is
 * delivered at the configured interval (default 100ms = 10fps).
 *
 * Usage:
 *   // Re-render at 10fps with the current intensity value
 *   const intensity = useFrame(loop, frame => frame.intensity(), 100);
 *
 *   // Re-render at 4fps with a derived object
 *   const data = useFrame(loop, frame => ({
 *     bid: frame.bestBid(),
 *     ask: frame.bestAsk(),
 *   }), 250);
 */

import { useState, useEffect, useRef } from 'react';
import type { AnimationLoop } from '../view';
import type { IFrameConsumer } from '../core/interfaces';

const DEFAULT_THROTTLE_MS = 100;

export function useFrame<F, T>(
  loop: AnimationLoop<F> | null,
  extract: (frame: F) => T,
  throttleMs: number = DEFAULT_THROTTLE_MS,
): T | null {
  const [value, setValue] = useState<T | null>(null);
  const extractRef = useRef(extract);

  // Keep the extract function ref current to avoid stale closures
  extractRef.current = extract;

  useEffect(() => {
    if (!loop) return;

    let lastUpdate = 0;

    const consumer: IFrameConsumer<F> = {
      priority: 100, // Low priority — cosmetic, runs after data-critical consumers

      onFrame(frame: F, nowMs: number): void {
        if (nowMs - lastUpdate < throttleMs) return;
        lastUpdate = nowMs;
        const extracted = extractRef.current(frame);
        setValue(extracted);
      },
    };

    loop.addConsumer(consumer);

    return () => {
      loop.removeConsumer(consumer);
    };
  }, [loop, throttleMs]);

  return value;
}
