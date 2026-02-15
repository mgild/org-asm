import React from 'react';
import { render } from '@testing-library/react';
import { WasmErrorBoundary } from '../WasmErrorBoundary';
import type { WasmErrorFallbackProps } from '../WasmErrorBoundary';
import type { ErrorInfo } from 'react';

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('WASM panic');
  return <div>OK</div>;
}

describe('WasmErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when no error', () => {
    const { container } = render(
      <WasmErrorBoundary fallback="Error occurred">
        <div>Child content</div>
      </WasmErrorBoundary>,
    );

    expect(container.textContent).toBe('Child content');
  });

  it('shows string fallback when child throws', () => {
    const { container } = render(
      <WasmErrorBoundary fallback="Something went wrong">
        <ThrowingComponent shouldThrow={true} />
      </WasmErrorBoundary>,
    );

    expect(container.textContent).toBe('Something went wrong');
  });

  it('shows render function fallback when child throws', () => {
    const fallback = ({ error, reset }: WasmErrorFallbackProps) => (
      <div>
        <span>Error: {error.message}</span>
        <button onClick={reset}>Reset</button>
      </div>
    );

    const { container } = render(
      <WasmErrorBoundary fallback={fallback}>
        <ThrowingComponent shouldThrow={true} />
      </WasmErrorBoundary>,
    );

    expect(container.textContent).toContain('Error: WASM panic');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('onError callback fires with error and errorInfo', () => {
    const onError = vi.fn<(error: Error, errorInfo: ErrorInfo) => void>();

    render(
      <WasmErrorBoundary fallback="Error" onError={onError}>
        <ThrowingComponent shouldThrow={true} />
      </WasmErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('WASM panic');
    expect(onError.mock.calls[0][1]).toHaveProperty('componentStack');
  });

  it('reset clears error and re-renders children', () => {
    let shouldThrow = true;
    let resetFn: (() => void) | null = null;

    const fallback = ({ error, reset }: WasmErrorFallbackProps) => {
      resetFn = reset;
      return <div>Error: {error.message}</div>;
    };

    function ConditionalThrower() {
      if (shouldThrow) throw new Error('WASM panic');
      return <div>Recovered</div>;
    }

    const { container } = render(
      <WasmErrorBoundary fallback={fallback}>
        <ConditionalThrower />
      </WasmErrorBoundary>,
    );

    expect(container.textContent).toContain('Error: WASM panic');
    expect(resetFn).not.toBeNull();

    // Stop throwing, then reset
    shouldThrow = false;
    React.act(() => {
      resetFn!();
    });

    expect(container.textContent).toBe('Recovered');
  });

  it('onReset callback fires when reset is called', () => {
    let shouldThrow = true;
    let resetFn: (() => void) | null = null;
    const onReset = vi.fn();

    const fallback = ({ reset }: WasmErrorFallbackProps) => {
      resetFn = reset;
      return <div>Error fallback</div>;
    };

    function ConditionalThrower() {
      if (shouldThrow) throw new Error('WASM panic');
      return <div>OK</div>;
    }

    render(
      <WasmErrorBoundary fallback={fallback} onReset={onReset}>
        <ConditionalThrower />
      </WasmErrorBoundary>,
    );

    expect(onReset).not.toHaveBeenCalled();

    shouldThrow = false;
    React.act(() => {
      resetFn!();
    });

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
