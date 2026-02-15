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

import { ConnectionState } from '../core/types';
import type { ConnectionError } from '../core/types';
import type {
  IConnectionPipeline,
  MessageHandler,
  ConnectionHandler,
  StateChangeHandler,
  ErrorHandler,
} from './connectionTypes';

// Re-export for backward compatibility — consumers importing from WebSocketPipeline still work
export { ConnectionState };
export type { ConnectionError, MessageHandler, ConnectionHandler, StateChangeHandler, ErrorHandler };

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
  /** Heartbeat interval in ms (default: disabled). Sends a keepalive message at this interval to prevent proxy timeouts. */
  heartbeatIntervalMs?: number;
  /** Heartbeat message to send (default: single zero byte). Can be string or ArrayBuffer. */
  heartbeatMessage?: ArrayBuffer | string;
}

export type BinaryMessageHandler = (data: ArrayBuffer) => void;
export type BinaryMiddleware = (data: ArrayBuffer, next: () => void) => void;

export class WebSocketPipeline implements IConnectionPipeline {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private _state: ConnectionState = ConnectionState.Disconnected;
  private _lastMessageAt = 0;

  // Handlers (multi-subscriber)
  private messageHandlers: MessageHandler[] = [];
  private binaryMessageHandler: BinaryMessageHandler | null = null;
  private connectHandlers: ConnectionHandler[] = [];
  private disconnectHandlers: ConnectionHandler[] = [];
  private stateChangeHandlers: StateChangeHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];

  // Binary middleware chain (runs before terminal binaryMessageHandler)
  private _binaryMiddleware: BinaryMiddleware[] = [];

  // Message counters
  private _messageCount = 0;
  private _binaryMessageCount = 0;

  // Heartbeat state
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

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
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 0,
      heartbeatMessage: config.heartbeatMessage ?? new Uint8Array([0]).buffer,
    };
  }

  // ============================================
  // Handler registration
  // ============================================

  /** Add a handler for incoming text messages */
  onMessage(handler: MessageHandler): this {
    this.messageHandlers.push(handler);
    return this;
  }

  /** Set the terminal handler for incoming binary messages (ArrayBuffer) */
  onBinaryMessage(handler: BinaryMessageHandler): this {
    this.binaryMessageHandler = handler;
    return this;
  }

  /** Add a handler for connection open */
  onConnect(handler: ConnectionHandler): this {
    this.connectHandlers.push(handler);
    return this;
  }

  /** Add a handler for connection close */
  onDisconnect(handler: ConnectionHandler): this {
    this.disconnectHandlers.push(handler);
    return this;
  }

  /** Add a handler for state transitions */
  onStateChange(handler: StateChangeHandler): this {
    this.stateChangeHandlers.push(handler);
    return this;
  }

  /** Add a handler for connection errors */
  onError(handler: ErrorHandler): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /** Add binary message middleware. Runs before the terminal onBinaryMessage handler. Returns unsubscribe function. */
  use(middleware: BinaryMiddleware): () => void {
    this._binaryMiddleware.push(middleware);
    return () => {
      const i = this._binaryMiddleware.indexOf(middleware);
      if (i >= 0) this._binaryMiddleware.splice(i, 1);
    };
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
    this.stopHeartbeat();
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

  /** Total messages received (text + binary) */
  get messageCount(): number {
    return this._messageCount;
  }

  /** Total binary messages received */
  get binaryMessageCount(): number {
    return this._binaryMessageCount;
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
    for (const h of this.stateChangeHandlers) h(newState);
  }

  private emitError(type: ConnectionError['type'], message: string): void {
    const error: ConnectionError = {
      type,
      message,
      attempt: this.reconnectAttempts,
      timestamp: Date.now(),
    };
    for (const h of this.errorHandlers) h(error);
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
        this.dispatchBinaryMessage(frame);
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
  // Binary middleware dispatch
  // ============================================

  private dispatchBinaryMessage(data: ArrayBuffer): void {
    let index = 0;
    const chain = this._binaryMiddleware;
    const terminal = this.binaryMessageHandler;
    const next = () => {
      if (index < chain.length) {
        chain[index++](data, next);
      } else {
        terminal?.(data);
      }
    };
    next();
  }

  // ============================================
  // Heartbeat
  // ============================================

  private startHeartbeat(): void {
    if (!this.config.heartbeatIntervalMs) return;
    this._heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(this.config.heartbeatMessage);
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this._heartbeatInterval !== null) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
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
      for (const h of this.connectHandlers) h();
      if (this.config.backpressure) {
        this.startBackpressureLoop();
      }
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      this._lastMessageAt = Date.now();
      this._messageCount++;
      if (event.data instanceof ArrayBuffer) {
        this._binaryMessageCount++;
        if (this.config.backpressure) {
          // Latest-wins coalescing: store frame, deliver on next rAF
          this._latestBinaryFrame = event.data;
        } else {
          this.dispatchBinaryMessage(event.data);
        }
      } else {
        // Text messages always pass through immediately
        for (const h of this.messageHandlers) h(event.data as string);
      }
    };

    ws.onclose = () => {
      // Skip if this is an old ws that we intentionally abandoned (e.g., during StrictMode unmount)
      if (this.ws !== ws) return;
      this.stopBackpressureLoop();
      this.stopHeartbeat();
      for (const h of this.disconnectHandlers) h();

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
