import { renderHook, act } from '@testing-library/react';
import { useWasmStream } from '../useWasmStream';

describe('useWasmStream', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let rafSpy: ReturnType<typeof vi.fn>;
  let cafSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;

    rafSpy = vi.fn((cb: FrameRequestCallback): number => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });

    cafSpy = vi.fn((id: number): void => {
      rafCallbacks.delete(id);
    });

    vi.stubGlobal('requestAnimationFrame', rafSpy);
    vi.stubGlobal('cancelAnimationFrame', cafSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Fire all pending rAF callbacks. Must be called inside act(). */
  function flushRaf(): void {
    const cbs = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [, cb] of cbs) {
      cb(performance.now());
    }
  }

  it('sync stream: emits chunks synchronously, sets done', () => {
    // Sync stream: emit() schedules rAF, then sync completion path calls
    // flush() directly for remaining chunks.
    const { result } = renderHook(() =>
      useWasmStream<number>((emit) => {
        emit(1);
        emit(2);
        emit(3);
      }, []),
    );

    // The sync completion path calls flush() directly, which sets chunks.
    // But the rAF callback is still pending (was scheduled by emit).
    // Since flush() already drained accRef, the rAF callback is a no-op.
    expect(result.current.done).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.chunks).toEqual([1, 2, 3]);
  });

  it('sync stream with no chunks: done is true, chunks empty', () => {
    const { result } = renderHook(() =>
      useWasmStream<number>(() => {
        // emit nothing
      }, []),
    );

    expect(result.current.done).toBe(true);
    expect(result.current.chunks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('async stream: emits chunks, resolves, sets done', async () => {
    let resolve!: () => void;
    let emitFn!: (chunk: number) => void;
    const promise = new Promise<void>(r => {
      resolve = r;
    });

    const { result } = renderHook(() =>
      useWasmStream<number>((emit) => {
        emitFn = emit;
        return promise;
      }, []),
    );

    expect(result.current.done).toBe(false);

    // Emit chunks and flush the rAF to commit them to state
    act(() => {
      emitFn(10);
      emitFn(20);
      flushRaf();
    });

    expect(result.current.chunks).toEqual([10, 20]);

    // Resolve the async stream
    await act(async () => {
      resolve();
      await promise;
    });

    expect(result.current.done).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('async stream error: rejects with Error, sets error and done', async () => {
    const err = new Error('stream failed');
    let reject!: (e: Error) => void;
    let emitFn!: (chunk: number) => void;
    const promise = new Promise<void>((_, rej) => {
      reject = rej;
    });

    const { result } = renderHook(() =>
      useWasmStream<number>((emit) => {
        emitFn = emit;
        return promise;
      }, []),
    );

    // Emit a chunk before rejection
    act(() => {
      emitFn(1);
    });

    // Reject — hook's error handler calls flush() for remaining chunks
    await act(async () => {
      reject(err);
      await promise.catch(() => {});
    });

    expect(result.current.error).toBe(err);
    expect(result.current.done).toBe(true);
    // flush() was called by the rejection handler, draining accRef
    expect(result.current.chunks).toEqual([1]);
  });

  it('async stream error: rejects with string, wraps in Error', async () => {
    let reject!: (e: string) => void;
    const promise = new Promise<void>((_, rej) => {
      reject = rej;
    });

    const { result } = renderHook(() =>
      useWasmStream<number>(() => promise, []),
    );

    await act(async () => {
      reject('string error');
      await promise.catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string error');
    expect(result.current.done).toBe(true);
  });

  it('sync throw: catches error, sets error and done', () => {
    const err = new Error('sync kaboom');

    const { result } = renderHook(() =>
      useWasmStream<number>(() => {
        throw err;
      }, []),
    );

    expect(result.current.error).toBe(err);
    expect(result.current.done).toBe(true);
    expect(result.current.chunks).toEqual([]);
  });

  it('stale: emit after cleanup is ignored', async () => {
    let emitFn!: (chunk: number) => void;
    let resolve!: () => void;
    const promise1 = new Promise<void>(r => {
      resolve = r;
    });

    let dep = 'a';

    const { result, rerender } = renderHook(() =>
      useWasmStream<number>((emit) => {
        if (dep === 'a') {
          emitFn = emit;
          return promise1;
        }
        // Second invocation: sync, no chunks
        return undefined;
      }, [dep]),
    );

    // Change deps to trigger cleanup (stale = true)
    dep = 'b';
    rerender();

    // Try emitting on the stale stream — should be a no-op
    act(() => {
      emitFn(999);
      flushRaf();
    });

    // Resolve first promise
    await act(async () => {
      resolve();
      await promise1;
    });

    // Should not contain stale emit
    expect(result.current.chunks).toEqual([]);
    expect(result.current.done).toBe(true);
  });

  it('stale: async resolution after cleanup is ignored', async () => {
    let resolve1!: () => void;
    const promise1 = new Promise<void>(r => {
      resolve1 = r;
    });

    let callCount = 0;
    let dep = 'a';

    const { result, rerender } = renderHook(() =>
      useWasmStream<number>((emit) => {
        callCount++;
        if (callCount === 1) {
          return promise1;
        }
        emit(100);
        return undefined; // sync second call
      }, [dep]),
    );

    // Change deps before first promise resolves — triggers second call
    dep = 'b';
    rerender();

    // Second call was sync and completed (flush called directly)
    expect(result.current.done).toBe(true);
    expect(result.current.chunks).toEqual([100]);

    // Now resolve the stale first promise — should be ignored
    await act(async () => {
      resolve1();
      await promise1;
    });

    // State should not change from the stale resolution
    expect(result.current.chunks).toEqual([100]);
    expect(result.current.done).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('stale: async rejection after cleanup is ignored', async () => {
    let reject1!: (e: Error) => void;
    const promise1 = new Promise<void>((_, rej) => {
      reject1 = rej;
    });

    let callCount = 0;
    let dep = 'a';

    const { result, rerender } = renderHook(() =>
      useWasmStream<number>((emit) => {
        callCount++;
        if (callCount === 1) {
          return promise1;
        }
        emit(50);
        return undefined; // sync second call
      }, [dep]),
    );

    // Change deps before first promise rejects
    dep = 'b';
    rerender();

    expect(result.current.done).toBe(true);
    expect(result.current.chunks).toEqual([50]);

    // Now reject the stale first promise — should be ignored
    await act(async () => {
      reject1(new Error('stale rejection'));
      await promise1.catch(() => {});
    });

    expect(result.current.error).toBeNull();
    expect(result.current.chunks).toEqual([50]);
  });

  it('rAF batching: multiple emits batch into one rAF call', async () => {
    let emitFn!: (chunk: number) => void;
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
      resolve = r;
    });

    const { result } = renderHook(() =>
      useWasmStream<number>((emit) => {
        emitFn = emit;
        return promise;
      }, []),
    );

    // Emit several chunks — only one rAF should be scheduled
    act(() => {
      emitFn(1);
      emitFn(2);
      emitFn(3);
    });

    // requestAnimationFrame was called exactly once for all 3 emits
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Flush the single rAF — all 3 chunks arrive at once
    act(() => {
      flushRaf();
    });

    expect(result.current.chunks).toEqual([1, 2, 3]);

    await act(async () => {
      resolve();
      await promise;
    });

    expect(result.current.done).toBe(true);
  });

  it('cleanup cancels pending rAF', () => {
    let emitFn!: (chunk: number) => void;

    let dep = 'a';

    const { rerender } = renderHook(() =>
      useWasmStream<number>((emit) => {
        if (dep === 'a') {
          emitFn = emit;
          return new Promise<void>(() => {}); // never resolves
        }
        return undefined;
      }, [dep]),
    );

    // Emit to schedule a rAF
    act(() => {
      emitFn(1);
    });

    expect(rafSpy).toHaveBeenCalled();

    // Change deps triggers cleanup which should cancelAnimationFrame
    dep = 'b';
    rerender();

    // cancelAnimationFrame should have been called
    expect(cafSpy).toHaveBeenCalled();
  });

  it('flush with remaining chunks on async completion', async () => {
    let emitFn!: (chunk: number) => void;
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
      resolve = r;
    });

    const { result } = renderHook(() =>
      useWasmStream<number>((emit) => {
        emitFn = emit;
        return promise;
      }, []),
    );

    // Emit chunks but do NOT flush rAF
    act(() => {
      emitFn(1);
      emitFn(2);
    });

    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Resolve the promise — the hook's completion handler calls flush()
    // directly for remaining chunks before setting done
    await act(async () => {
      resolve();
      await promise;
    });

    // Chunks were flushed by the completion handler
    expect(result.current.chunks).toEqual([1, 2]);
    expect(result.current.done).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sync throw with non-Error value: wraps in Error', () => {
    const { result } = renderHook(() =>
      useWasmStream<number>(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'string thrown';
      }, []),
    );

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string thrown');
    expect(result.current.done).toBe(true);
    expect(result.current.chunks).toEqual([]);
  });
});
