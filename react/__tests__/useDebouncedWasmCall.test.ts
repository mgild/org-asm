import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedWasmCall } from '../useDebouncedWasmCall';

describe('useDebouncedWasmCall', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null initially before timer fires', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useDebouncedWasmCall(() => 'hello', [], 100),
    );
    expect(result.current).toBe(null);
  });

  it('returns computed value after delay', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useDebouncedWasmCall(() => 42, [], 200),
    );
    expect(result.current).toBe(null);

    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(42);
  });

  it('cancels previous timer when deps change before delay', () => {
    vi.useFakeTimers();
    const fn1 = vi.fn(() => 'first');
    const fn2 = vi.fn(() => 'second');

    let dep = 'a';
    let fn = fn1;
    const { result, rerender } = renderHook(() =>
      useDebouncedWasmCall(fn, [dep], 300),
    );
    expect(result.current).toBe(null);

    // Advance only 150ms (half the delay), then change deps
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current).toBe(null);

    dep = 'b';
    fn = fn2;
    rerender();

    // The first timer should have been cancelled
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current).toBe(null);
    expect(fn1).not.toHaveBeenCalled();

    // After the full new delay, fn2 fires
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current).toBe('second');
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('uses latest fn ref when timer fires', () => {
    vi.useFakeTimers();
    let value = 'initial';
    const { result, rerender } = renderHook(() =>
      useDebouncedWasmCall(() => value, ['stable-dep'], 100),
    );

    // Change the captured value before the timer fires
    value = 'updated';
    rerender();

    act(() => { vi.advanceTimersByTime(100); });
    // Should use the latest fn, which reads the updated value
    expect(result.current).toBe('updated');
  });

  it('re-fires when delayMs changes', () => {
    vi.useFakeTimers();
    let callCount = 0;
    let delay = 100;
    const { result, rerender } = renderHook(() =>
      useDebouncedWasmCall(() => ++callCount, [], delay),
    );

    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(1);

    // Change delay — should schedule a new timer
    delay = 200;
    rerender();

    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(2);
  });

  it('clears timer on unmount', () => {
    vi.useFakeTimers();
    const fn = vi.fn(() => 'result');
    const { result, unmount } = renderHook(() =>
      useDebouncedWasmCall(fn, [], 500),
    );
    expect(result.current).toBe(null);

    unmount();

    // Advancing timers after unmount should not call fn
    act(() => { vi.advanceTimersByTime(500); });
    expect(fn).not.toHaveBeenCalled();
  });
});
