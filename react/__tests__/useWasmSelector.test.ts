import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWasmSelector } from '../useWasmSelector';
import { createNotifier } from '../useWasmState';

describe('useWasmSelector', () => {
  it('returns initial snapshot', () => {
    const notifier = createNotifier();
    const { result } = renderHook(() =>
      useWasmSelector(notifier, () => ({ x: 1 })),
    );
    expect(result.current).toEqual({ x: 1 });
  });

  it('returns same reference when snapshot is structurally equal', () => {
    const notifier = createNotifier();
    let counter = 0;
    const { result } = renderHook(() =>
      useWasmSelector(notifier, () => {
        counter++;
        return { x: 1 };
      }),
    );
    const firstRef = result.current;
    act(() => { notifier.notify(); });
    expect(counter).toBeGreaterThan(1);
    expect(result.current).toBe(firstRef);
  });

  it('returns new reference when snapshot structurally differs', () => {
    const notifier = createNotifier();
    let val = 1;
    const { result } = renderHook(() =>
      useWasmSelector(notifier, () => ({ x: val })),
    );
    const firstRef = result.current;
    expect(firstRef).toEqual({ x: 1 });

    val = 2;
    act(() => { notifier.notify(); });
    expect(result.current).toEqual({ x: 2 });
    expect(result.current).not.toBe(firstRef);
  });

  describe('shallowEqual branches', () => {
    it('Object.is fast path — same reference returns true', () => {
      const notifier = createNotifier();
      const stable = { x: 1 };
      const { result } = renderHook(() =>
        useWasmSelector(notifier, () => stable),
      );
      const firstRef = result.current;
      act(() => { notifier.notify(); });
      expect(result.current).toBe(firstRef);
    });

    it('primitives that are not objects return false', () => {
      const notifier = createNotifier();
      let val: number | string = 42;
      const { result } = renderHook(() =>
        useWasmSelector(
          notifier,
          () => val as number | string,
          // Force shallowEqual to run by always saying "not equal"
          // so we can observe reference identity change
        ),
      );
      expect(result.current).toBe(42);
      // Change to a different primitive type — shallowEqual gets
      // typeof a !== 'object' and returns false, so new ref is returned
      val = 'hello';
      act(() => { notifier.notify(); });
      expect(result.current).toBe('hello');
    });

    it('null value returns false from shallowEqual', () => {
      const notifier = createNotifier();
      let val: { x: number } | null = { x: 1 };
      const { result } = renderHook(() =>
        useWasmSelector(notifier, () => val),
      );
      expect(result.current).toEqual({ x: 1 });
      val = null;
      act(() => { notifier.notify(); });
      expect(result.current).toBe(null);
    });

    it('different key counts return false', () => {
      const notifier = createNotifier();
      let val: Record<string, number> = { x: 1 };
      const { result } = renderHook(() =>
        useWasmSelector(notifier, () => val),
      );
      const firstRef = result.current;
      val = { x: 1, y: 2 };
      act(() => { notifier.notify(); });
      expect(result.current).not.toBe(firstRef);
      expect(result.current).toEqual({ x: 1, y: 2 });
    });

    it('missing key in b returns false', () => {
      const notifier = createNotifier();
      let val: Record<string, number> = { x: 1, y: 2 };
      const { result } = renderHook(() =>
        useWasmSelector(notifier, () => val),
      );
      const firstRef = result.current;
      // Same number of keys but different key names
      val = { x: 1, z: 2 };
      act(() => { notifier.notify(); });
      expect(result.current).not.toBe(firstRef);
      expect(result.current).toEqual({ x: 1, z: 2 });
    });

    it('different values for same key returns false', () => {
      const notifier = createNotifier();
      let val = { x: 1, y: 2 };
      const { result } = renderHook(() =>
        useWasmSelector(notifier, () => val),
      );
      const firstRef = result.current;
      val = { x: 1, y: 999 };
      act(() => { notifier.notify(); });
      expect(result.current).not.toBe(firstRef);
      expect(result.current).toEqual({ x: 1, y: 999 });
    });
  });

  it('uses custom isEqual function instead of shallowEqual', () => {
    const notifier = createNotifier();
    let val = { x: 1, irrelevant: 100 };
    // Custom equality that only compares the `x` field
    const customEqual = (a: typeof val, b: typeof val): boolean => a.x === b.x;

    const { result } = renderHook(() =>
      useWasmSelector(notifier, () => val, customEqual),
    );
    const firstRef = result.current;

    // Change only irrelevant field — custom equality says "equal"
    val = { x: 1, irrelevant: 999 };
    act(() => { notifier.notify(); });
    expect(result.current).toBe(firstRef);

    // Change x — custom equality says "not equal"
    val = { x: 2, irrelevant: 999 };
    act(() => { notifier.notify(); });
    expect(result.current).not.toBe(firstRef);
    expect(result.current).toEqual({ x: 2, irrelevant: 999 });
  });

  it('works with createNotifier from useWasmState', () => {
    const notifier = createNotifier();
    let count = 0;
    const { result } = renderHook(() =>
      useWasmSelector(notifier, () => ({ count: count })),
    );
    expect(result.current).toEqual({ count: 0 });

    count = 5;
    act(() => { notifier.notify(); });
    expect(result.current).toEqual({ count: 5 });

    // Batch multiple notifications — subscribers only fire once
    count = 10;
    act(() => {
      notifier.batch(() => {
        notifier.notify();
        notifier.notify();
        notifier.notify();
      });
    });
    expect(result.current).toEqual({ count: 10 });
  });
});
