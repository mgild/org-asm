/**
 * WebSocketPipeline — Manages WebSocket connections with auto-reconnect,
 * exponential backoff, state machine, staleness tracking, backpressure,
 * and structured error surfacing.
 *
 * The pipeline connects to a data source and routes raw messages to handlers.
 * It does NOT parse messages — that's the handler's job (separation of concerns).
 *
 * Pattern: WebSocket → raw string → handler(string) → engine methods
 *
 * This decouples the connection lifecycle from data processing.
 * The same pipeline works for any WebSocket data source.
 */

import { ConnectionState, ConnectionError } from '../core/types';

export { ConnectionState, ConnectionError };

export interface WebSocketConfig {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Base reconnect delay in ms (default: 1000). Backs off exponentially. */
  reconnectDelayMs?: number;
  /** Maximum reconnect delay in ms (default: 30000). Backoff caps here. */
  maxReconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Protocols to pass to WebSocket constructor */
  protocols?: string[];
  /** Binary type for the WebSocket (default: 'blob'). Set to 'arraybuffer' for binary frame pipelines. */
  binaryType?: BinaryType;
  /** Staleness threshold in ms (default: 5000). pipeline.stale becomes true when no message received within this window. */
  staleThresholdMs?: number;
  /** Enable binary frame backpressure (default: false). When true, binary messages are coalesced via rAF (latest-wins). */
  backpressure?: boolean;
}

export type MessageHandler = (data: string) => void;
export type BinaryMessageHandler = (data: ArrayBuffer) => void;
export type ConnectionHandler = () => void;
export type StateChangeHandler = (state: ConnectionState) => void;
export type ErrorHandler = (error: ConnectionError) => void;

export class WebSocketPipeline {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private _state: ConnectionState = ConnectionState.Disconnected;
  private _lastMessageAt = 0;

  // Handlers
  private messageHandler: MessageHandler | null = null;
  private binaryMessageHandler: BinaryMessageHandler | null = null;
  private connectHandler: ConnectionHandler | null = null;
  private disconnectHandler: ConnectionHandler | null = null;
  private stateChangeHandler: StateChangeHandler | null = null;
  private errorHandler: ErrorHandler | null = null;

  // Backpressure state
  private _latestBinaryFrame: ArrayBuffer | null = null;
  private _rafId: number | null = null;

  constructor(config: WebSocketConfig) {
    this.config = {
      url: config.url,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
      protocols: config.protocols ?? [],
      binaryType: config.binaryType ?? 'blob',
      staleThresholdMs: config.staleThresholdMs ?? 5000,
      backpressure: config.backpressure ?? false,
    };
  }

  // ============================================
  // Handler registration
  // ============================================

  /** Set the handler for incoming text messages */
  onMessage(handler: MessageHandler): this {
    this.messageHandler = handler;
    return this;
  }

  /** Set the handler for incoming binary messages (ArrayBuffer) */
  onBinaryMessage(handler: BinaryMessageHandler): this {
    this.binaryMessageHandler = handler;
    return this;
  }

  /** Set the handler for connection open */
  onConnect(handler: ConnectionHandler): this {
    this.connectHandler = handler;
    return this;
  }

  /** Set the handler for connection close */
  onDisconnect(handler: ConnectionHandler): this {
    this.disconnectHandler = handler;
    return this;
  }

  /** Set the handler for state transitions */
  onStateChange(handler: StateChangeHandler): this {
    this.stateChangeHandler = handler;
    return this;
  }

  /** Set the handler for connection errors */
  onError(handler: ErrorHandler): this {
    this.errorHandler = handler;
    return this;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionallyClosed = false;
    this.setState(ConnectionState.Connecting);
    this.createConnection();
  }

  /** Disconnect and stop reconnecting */
  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopBackpressureLoop();
    // Only close if OPEN to avoid "closed before connection established" error
    // during React StrictMode unmount-remount cycles
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
    this.setState(ConnectionState.Disconnected);
  }

  // ============================================
  // Getters
  // ============================================

  /** Whether the WebSocket is currently connected (backward compat) */
  get connected(): boolean {
    return this._state === ConnectionState.Connected;
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Whether the connection is stale (no message within staleThresholdMs) */
  get stale(): boolean {
    if (this._lastMessageAt === 0) return false;
    return Date.now() - this._lastMessageAt > this.config.staleThresholdMs;
  }

  /** Timestamp of last received message (0 if none) */
  get lastMessageTime(): number {
    return this._lastMessageAt;
  }

  // ============================================
  // Send
  // ============================================

  /** Update the URL (takes effect on next connect/reconnect) */
  setUrl(url: string): void {
    this.config.url = url;
  }

  /** Send a text message to the server */
  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /** Send binary data to the server */
  sendBinary(data: ArrayBuffer | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  // ============================================
  // State machine
  // ============================================

  private setState(newState: ConnectionState): void {
    if (this._state === newState) return;
    this._state = newState;
    this.stateChangeHandler?.(newState);
  }

  private emitError(type: ConnectionError['type'], message: string): void {
    this.errorHandler?.({
      type,
      message,
      attempt: this.reconnectAttempts,
      timestamp: Date.now(),
    });
  }

  // ============================================
  // Backoff
  // ============================================

  private computeReconnectDelay(): number {
    const base = this.config.reconnectDelayMs;
    const max = this.config.maxReconnectDelayMs;
    const exponential = Math.min(base * Math.pow(2, this.reconnectAttempts), max);
    const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
    return exponential + jitter;
  }

  // ============================================
  // Backpressure (opt-in rAF coalescing)
  // ============================================

  private startBackpressureLoop(): void {
    if (this._rafId !== null) return;
    const flush = () => {
      if (this._latestBinaryFrame !== null) {
        const frame = this._latestBinaryFrame;
        this._latestBinaryFrame = null;
        this.binaryMessageHandler?.(frame);
      }
      this._rafId = requestAnimationFrame(flush);
    };
    this._rafId = requestAnimationFrame(flush);
  }

  private stopBackpressureLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._latestBinaryFrame = null;
  }

  // ============================================
  // Connection
  // ============================================

  private createConnection(): void {
    const ws = new WebSocket(this.config.url, this.config.protocols);
    ws.binaryType = this.config.binaryType;
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState(ConnectionState.Connected);
      this.connectHandler?.();
      if (this.config.backpressure) {
        this.startBackpressureLoop();
      }
    };

    ws.onmessage = (event) => {
      this._lastMessageAt = Date.now();
      if (event.data instanceof ArrayBuffer) {
        if (this.config.backpressure) {
          // Latest-wins coalescing: store frame, deliver on next rAF
          this._latestBinaryFrame = event.data;
        } else {
          this.binaryMessageHandler?.(event.data);
        }
      } else {
        // Text messages always pass through immediately
        this.messageHandler?.(event.data as string);
      }
    };

    ws.onclose = () => {
      // Skip if this is an old ws that we intentionally abandoned (e.g., during StrictMode unmount)
      if (this.ws !== ws) return;
      this.stopBackpressureLoop();
      this.disconnectHandler?.();

      if (this.intentionallyClosed) {
        this.setState(ConnectionState.Disconnected);
        return;
      }

      // Determine error type based on whether we ever connected
      if (this._state === ConnectionState.Connected || this._state === ConnectionState.Reconnecting) {
        this.emitError('connection_lost', `Connection lost (attempt ${this.reconnectAttempts})`);
      } else {
        this.emitError('connect_failed', `Connection failed (attempt ${this.reconnectAttempts + 1})`);
      }

      if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.setState(ConnectionState.Reconnecting);
        const delay = this.computeReconnectDelay();
        this.reconnectAttempts++;
        this.reconnectTimeout = setTimeout(() => {
          this.createConnection();
        }, delay);
      } else {
        this.emitError('max_retries_exhausted', `Gave up after ${this.reconnectAttempts} attempts`);
        this.setState(ConnectionState.Disconnected);
      }
    };

    ws.onerror = () => {
      // Only close if this is still the current ws
      if (this.ws === ws) {
        ws.close();
      }
    };
  }
}
