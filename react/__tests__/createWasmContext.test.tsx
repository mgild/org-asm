import React from 'react';
import { renderHook, render } from '@testing-library/react';
import { createWasmContext } from '../createWasmContext';
import { createNotifier } from '../useWasmState';
import type { WasmNotifier } from '../useWasmState';

interface TestEngine {
  version: number;
}

describe('createWasmContext', () => {
  it('useEngine returns engine from provider', () => {
    const ctx = createWasmContext<TestEngine>();
    const engine: TestEngine = { version: 42 };
    const notifier = createNotifier();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.WasmProvider engine={engine} notifier={notifier}>
        {children}
      </ctx.WasmProvider>
    );

    const { result } = renderHook(() => ctx.useEngine(), { wrapper });
    expect(result.current).toBe(engine);
    expect(result.current.version).toBe(42);
  });

  it('useNotifier returns notifier from provider', () => {
    const ctx = createWasmContext<TestEngine>();
    const engine: TestEngine = { version: 1 };
    const notifier = createNotifier();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.WasmProvider engine={engine} notifier={notifier}>
        {children}
      </ctx.WasmProvider>
    );

    const { result } = renderHook(() => ctx.useNotifier(), { wrapper });
    const returned: WasmNotifier = result.current;
    expect(returned).toBe(notifier);
    expect(typeof returned.subscribe).toBe('function');
    expect(typeof returned.notify).toBe('function');
    expect(typeof returned.batch).toBe('function');
  });

  it('useEngine throws outside WasmProvider', () => {
    const ctx = createWasmContext<TestEngine>();

    expect(() => {
      renderHook(() => ctx.useEngine());
    }).toThrow('useEngine must be used within a WasmProvider');
  });

  it('useNotifier throws outside WasmProvider', () => {
    const ctx = createWasmContext<TestEngine>();

    expect(() => {
      renderHook(() => ctx.useNotifier());
    }).toThrow('useNotifier must be used within a WasmProvider');
  });

  it('children render correctly inside WasmProvider', () => {
    const ctx = createWasmContext<TestEngine>();
    const engine: TestEngine = { version: 1 };
    const notifier = createNotifier();

    const { container } = render(
      <ctx.WasmProvider engine={engine} notifier={notifier}>
        <div data-testid="child">Hello from child</div>
      </ctx.WasmProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });
});
