import { renderHook, act } from '@testing-library/react';
import { useWasmReducer } from '../useWasmReducer';
import type { WasmReducerConfig } from '../useWasmReducer';

interface MockEngine {
  value: number;
  add(n: number): void;
}

function createEngine(): MockEngine {
  return {
    value: 0,
    add(n: number) {
      this.value += n;
    },
  };
}

describe('useWasmReducer', () => {
  it('returns initial state from getSnapshot', () => {
    const engine = createEngine();
    engine.value = 7;

    const config: WasmReducerConfig<MockEngine, number, number> = {
      getSnapshot: (e) => e.value,
      dispatch: (e, action) => { e.add(action); },
    };

    const { result } = renderHook(() => useWasmReducer(engine, config));
    expect(result.current[0]).toBe(7);
    expect(typeof result.current[1]).toBe('function');
  });

  it('sync dispatch mutates engine and triggers re-render with new state', () => {
    const engine = createEngine();

    const config: WasmReducerConfig<MockEngine, number, number> = {
      getSnapshot: (e) => e.value,
      dispatch: (e, action) => { e.add(action); },
    };

    const { result } = renderHook(() => useWasmReducer(engine, config));
    expect(result.current[0]).toBe(0);

    act(() => {
      result.current[1](5);
    });

    expect(engine.value).toBe(5);
    expect(result.current[0]).toBe(5);

    act(() => {
      result.current[1](3);
    });

    expect(engine.value).toBe(8);
    expect(result.current[0]).toBe(8);
  });

  it('async dispatch resolves and triggers re-render', async () => {
    const engine = createEngine();

    let resolveDispatch: (() => void) | null = null;
    const config: WasmReducerConfig<MockEngine, number, number> = {
      getSnapshot: (e) => e.value,
      dispatch: (e, action) => {
        return new Promise<void>((resolve) => {
          resolveDispatch = () => {
            e.add(action);
            resolve();
          };
        });
      },
    };

    const { result } = renderHook(() => useWasmReducer(engine, config));
    expect(result.current[0]).toBe(0);

    act(() => {
      result.current[1](10);
    });

    // Async hasn't resolved yet - state unchanged from sync perspective
    // but the dispatch was called, so the promise is pending

    await act(async () => {
      resolveDispatch!();
    });

    expect(engine.value).toBe(10);
    expect(result.current[0]).toBe(10);
  });

  it('async dispatch rejects and still triggers re-render', async () => {
    const engine = createEngine();

    let rejectDispatch: (() => void) | null = null;
    const config: WasmReducerConfig<MockEngine, number, number> = {
      getSnapshot: (e) => e.value,
      dispatch: (e, action) => {
        return new Promise<void>((_resolve, reject) => {
          rejectDispatch = () => {
            e.add(action);
            reject(new Error('dispatch failed'));
          };
        });
      },
    };

    const { result } = renderHook(() => useWasmReducer(engine, config));
    expect(result.current[0]).toBe(0);

    act(() => {
      result.current[1](3);
    });

    await act(async () => {
      rejectDispatch!();
    });

    // Even though it rejected, the engine was mutated and re-render fires
    expect(engine.value).toBe(3);
    expect(result.current[0]).toBe(3);
  });

  it('handles multiple dispatches in sequence', () => {
    const engine = createEngine();

    const config: WasmReducerConfig<MockEngine, number, number> = {
      getSnapshot: (e) => e.value,
      dispatch: (e, action) => { e.add(action); },
    };

    const { result } = renderHook(() => useWasmReducer(engine, config));

    act(() => {
      result.current[1](1);
      result.current[1](2);
      result.current[1](3);
    });

    expect(engine.value).toBe(6);
    expect(result.current[0]).toBe(6);
  });
});
