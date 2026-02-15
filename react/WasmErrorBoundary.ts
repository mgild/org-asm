/**
 * WasmErrorBoundary — React error boundary for WASM panics.
 *
 * When a WASM engine panics (integer overflow, unwrap on None, out of bounds),
 * wasm-bindgen throws a JS Error that crashes the React component tree.
 * This boundary catches the error, renders a fallback, and optionally
 * re-initializes the engine via onReset.
 *
 * Usage:
 *   <WasmErrorBoundary
 *     fallback={({ error, reset }) => (
 *       <div>
 *         <p>Engine crashed: {error.message}</p>
 *         <button onClick={reset}>Restart</button>
 *       </div>
 *     )}
 *     onError={(error) => reportToSentry(error)}
 *     onReset={() => { engine = new MyEngine(); }}
 *   >
 *     <TradingDashboard />
 *   </WasmErrorBoundary>
 *
 *   // Simple string fallback:
 *   <WasmErrorBoundary fallback="Something went wrong">
 *     <App />
 *   </WasmErrorBoundary>
 */

import { Component, createElement } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

export interface WasmErrorFallbackProps {
  error: Error;
  reset: () => void;
}

export interface WasmErrorBoundaryProps {
  children: ReactNode;
  /** Render function or static ReactNode shown when an error is caught. */
  fallback: ReactNode | ((props: WasmErrorFallbackProps) => ReactNode);
  /** Called when an error is caught. Use for error reporting (Sentry, etc). */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Called when the user triggers a reset. Re-initialize your engine here. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class WasmErrorBoundary extends Component<WasmErrorBoundaryProps, State> {
  constructor(props: WasmErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      const { fallback } = this.props;
      if (typeof fallback === 'function') {
        return (fallback as (props: WasmErrorFallbackProps) => ReactNode)({ error, reset: this.reset });
      }
      return fallback;
    }
    return this.props.children;
  }
}
