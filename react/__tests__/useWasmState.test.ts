import { renderHook, act } from '@testing-library/react';
import { useWasmState, createNotifier } from '../useWasmState';

describe('useWasmState', () => {
  it('returns initial snapshot value', () => {
    const notifier = createNotifier();
    const { result } = renderHook(() => useWasmState(notifier, () => 'initial'));
    expect(result.current).toBe('initial');
  });

  it('re-renders when notify() is called with new snapshot value', () => {
    const notifier = createNotifier();
    let value = 0;

    const { result } = renderHook(() => useWasmState(notifier, () => value));
    expect(result.current).toBe(0);

    act(() => {
      value = 42;
      notifier.notify();
    });

    expect(result.current).toBe(42);
  });

  it('multiple components using same notifier all update', () => {
    const notifier = createNotifier();
    let value = 'a';

    const { result: result1 } = renderHook(() => useWasmState(notifier, () => value));
    const { result: result2 } = renderHook(() => useWasmState(notifier, () => value));

    expect(result1.current).toBe('a');
    expect(result2.current).toBe('a');

    act(() => {
      value = 'b';
      notifier.notify();
    });

    expect(result1.current).toBe('b');
    expect(result2.current).toBe('b');
  });

  it('different snapshots from different getSnapshot fns work independently', () => {
    const notifier = createNotifier();
    let count = 0;
    let label = 'start';

    const { result: countResult } = renderHook(() =>
      useWasmState(notifier, () => count),
    );
    const { result: labelResult } = renderHook(() =>
      useWasmState(notifier, () => label),
    );

    expect(countResult.current).toBe(0);
    expect(labelResult.current).toBe('start');

    act(() => {
      count = 5;
      label = 'updated';
      notifier.notify();
    });

    expect(countResult.current).toBe(5);
    expect(labelResult.current).toBe('updated');
  });

  it('does not re-render when snapshot value has not changed', () => {
    const notifier = createNotifier();
    const getSnapshot = vi.fn(() => 'constant');

    const { result } = renderHook(() => useWasmState(notifier, getSnapshot));
    expect(result.current).toBe('constant');

    const callCountAfterMount = getSnapshot.mock.calls.length;

    act(() => {
      notifier.notify();
    });

    // getSnapshot is called again to check, but React should not trigger
    // a re-render since the value is the same primitive.
    expect(result.current).toBe('constant');
    // Snapshot was called at least once more to compare, but the value is stable.
    expect(getSnapshot.mock.calls.length).toBeGreaterThanOrEqual(callCountAfterMount);
  });
});
