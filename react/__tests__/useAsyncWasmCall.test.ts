import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncWasmCall } from '../useAsyncWasmCall';

describe('useAsyncWasmCall', () => {
  it('starts with loading: true, result: null, error: null', () => {
    const { result } = renderHook(() =>
      useAsyncWasmCall(() => new Promise<number>(() => {}), []),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('resolves: sets result and loading becomes false', async () => {
    let resolve!: (v: number) => void;
    const promise = new Promise<number>(r => {
      resolve = r;
    });

    const { result } = renderHook(() =>
      useAsyncWasmCall(() => promise, []),
    );

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve(42);
      await promise;
    });

    expect(result.current.result).toBe(42);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('rejects with Error: preserves the Error instance', async () => {
    const err = new Error('wasm trap');
    let reject!: (e: Error) => void;
    const promise = new Promise<number>((_, rej) => {
      reject = rej;
    });

    const { result } = renderHook(() =>
      useAsyncWasmCall(() => promise, []),
    );

    await act(async () => {
      reject(err);
      await promise.catch(() => {});
    });

    expect(result.current.error).toBe(err);
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it('rejects with string: wraps in Error via new Error(String(err))', async () => {
    let reject!: (e: string) => void;
    const promise = new Promise<number>((_, rej) => {
      reject = rej;
    });

    const { result } = renderHook(() =>
      useAsyncWasmCall(() => promise, []),
    );

    await act(async () => {
      reject('raw string error');
      await promise.catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('raw string error');
    expect(result.current.loading).toBe(false);
  });

  it('latest-wins: stale resolved result is discarded', async () => {
    let resolve1!: (v: number) => void;
    const promise1 = new Promise<number>(r => {
      resolve1 = r;
    });

    let resolve2!: (v: number) => void;
    const promise2 = new Promise<number>(r => {
      resolve2 = r;
    });

    let callCount = 0;
    let dep = 'a';

    const { result, rerender } = renderHook(() =>
      useAsyncWasmCall(() => {
        callCount++;
        return callCount === 1 ? promise1 : promise2;
      }, [dep]),
    );

    expect(result.current.loading).toBe(true);

    // Change deps before first promise resolves — triggers second call
    dep = 'b';
    rerender();

    // Resolve the second (current) promise first
    await act(async () => {
      resolve2(200);
      await promise2;
    });

    expect(result.current.result).toBe(200);
    expect(result.current.loading).toBe(false);

    // Now resolve the stale first promise — should be ignored
    await act(async () => {
      resolve1(100);
      await promise1;
    });

    // Result should still be 200 from the second call
    expect(result.current.result).toBe(200);
  });

  it('latest-wins: stale error is discarded', async () => {
    let reject1!: (e: Error) => void;
    const promise1 = new Promise<number>((_, rej) => {
      reject1 = rej;
    });

    let resolve2!: (v: number) => void;
    const promise2 = new Promise<number>(r => {
      resolve2 = r;
    });

    let callCount = 0;
    let dep = 'a';

    const { result, rerender } = renderHook(() =>
      useAsyncWasmCall(() => {
        callCount++;
        return callCount === 1 ? promise1 : promise2;
      }, [dep]),
    );

    // Change deps before first promise rejects
    dep = 'b';
    rerender();

    // Resolve the second (current) promise
    await act(async () => {
      resolve2(999);
      await promise2;
    });

    expect(result.current.result).toBe(999);
    expect(result.current.error).toBeNull();

    // Now reject the stale first promise — should be ignored
    await act(async () => {
      reject1(new Error('stale error'));
      await promise1.catch(() => {});
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result).toBe(999);
  });

  it('re-runs on deps change (new promise invoked)', async () => {
    let callCount = 0;
    let dep = 1;

    const { result, rerender } = renderHook(() =>
      useAsyncWasmCall(() => {
        callCount++;
        return Promise.resolve(dep * 10);
      }, [dep]),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.result).toBe(10);
    expect(callCount).toBe(1);

    dep = 2;
    rerender();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.result).toBe(20);
    expect(callCount).toBe(2);
  });
});
