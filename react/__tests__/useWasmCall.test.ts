import { renderHook } from '@testing-library/react';
import { useWasmCall } from '../useWasmCall';

describe('useWasmCall', () => {
  it('returns the computed value', () => {
    const { result } = renderHook(() => useWasmCall(() => 42, []));
    expect(result.current).toBe(42);
  });

  it('returns same value when deps unchanged (does not recompute)', () => {
    const factory = vi.fn(() => 'hello');
    const { rerender } = renderHook(() => useWasmCall(factory, ['stable']));

    expect(factory).toHaveBeenCalledTimes(1);

    rerender();
    rerender();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('recomputes when deps change', () => {
    let dep = 1;
    const factory = vi.fn(() => dep * 10);

    const { result, rerender } = renderHook(() => useWasmCall(factory, [dep]));
    expect(result.current).toBe(10);
    expect(factory).toHaveBeenCalledTimes(1);

    dep = 2;
    rerender();

    expect(result.current).toBe(20);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('works with different return types', () => {
    const { result: numResult } = renderHook(() => useWasmCall(() => 99, []));
    expect(numResult.current).toBe(99);

    const { result: strResult } = renderHook(() => useWasmCall(() => 'wasm', []));
    expect(strResult.current).toBe('wasm');

    const obj = { a: 1, b: [2, 3] };
    const { result: objResult } = renderHook(() => useWasmCall(() => obj, []));
    expect(objResult.current).toBe(obj);
  });
});
