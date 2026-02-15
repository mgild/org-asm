/**
 * SSEPipeline — Manages Server-Sent Events connections with auto-reconnect,
 * exponential backoff, state machine, staleness tracking, and structured
 * error surfacing.
 *
 * Implements the same IConnectionPipeline interface as WebSocketPipeline,
 * making the transport swappable for read-only data streams.
 *
 * Pattern: EventSource → raw string → handler(string) → engine methods
 *
 * Key differences from WebSocket:
 * - Read-only: send() is a no-op (Liskov substitutability)
 * - Text-only: SSE doesn't support binary frames
 * - No custom headers: EventSource API limitation (document to users)
 * - Self-managed reconnect: We close and reconnect ourselves rather than
 *   relying on EventSource's opaque built-in reconnect, for consistent
 *   behavior with WebSocketPipeline's backoff/jitter strategy.
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

export interface SSEConfig {
  /** SSE endpoint URL */
  url: string;
  /** Event types to listen for (default: ['message']) */
  eventTypes?: string[];
  /** Whether to send credentials with the request (default: false) */
  withCredentials?: boolean;
  /** Base reconnect delay in ms (default: 1000). Backs off exponentially. */
  reconnectDelayMs?: number;
  /** Maximum reconnect delay in ms (default: 30000). Backoff caps here. */
  maxReconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Staleness threshold in ms (default: 5000). pipeline.stale becomes true when no message received within this window. */
  staleThresholdMs?: number;
}

export class SSEPipeline implements IConnectionPipeline {
  private es: EventSource | null = null;
  private config: Required<SSEConfig>;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private _state: ConnectionState = ConnectionState.Disconnected;
  private _lastMessageAt = 0;

  // Handlers
  private messageHandler: MessageHandler | null = null;
  private connectHandler: ConnectionHandler | null = null;
  private disconnectHandler: ConnectionHandler | null = null;
  private stateChangeHandler: StateChangeHandler | null = null;
  private errorHandler: ErrorHandler | null = null;

  constructor(config: SSEConfig) {
    this.config = {
      url: config.url,
      eventTypes: config.eventTypes ?? ['message'],
      withCredentials: config.withCredentials ?? false,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
      staleThresholdMs: config.staleThresholdMs ?? 5000,
    };
  }

  // ============================================
  // Handler registration
  // ============================================

  onMessage(handler: MessageHandler): this {
    this.messageHandler = handler;
    return this;
  }

  onConnect(handler: ConnectionHandler): this {
    this.connectHandler = handler;
    return this;
  }

  onDisconnect(handler: ConnectionHandler): this {
    this.disconnectHandler = handler;
    return this;
  }

  onStateChange(handler: StateChangeHandler): this {
    this.stateChangeHandler = handler;
    return this;
  }

  onError(handler: ErrorHandler): this {
    this.errorHandler = handler;
    return this;
  }

  // ============================================
  // Lifecycle
  // ============================================

  connect(): void {
    if (this.es?.readyState === EventSource.OPEN) return;
    this.intentionallyClosed = false;
    this.setState(ConnectionState.Connecting);
    this.createConnection();
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.setState(ConnectionState.Disconnected);
  }

  // ============================================
  // Getters
  // ============================================

  get connected(): boolean {
    return this._state === ConnectionState.Connected;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get stale(): boolean {
    if (this._lastMessageAt === 0) return false;
    return Date.now() - this._lastMessageAt > this.config.staleThresholdMs;
  }

  get lastMessageTime(): number {
    return this._lastMessageAt;
  }

  // ============================================
  // Send (no-op for SSE — read-only transport)
  // ============================================

  setUrl(url: string): void {
    this.config.url = url;
  }

  /** No-op. SSE is a read-only transport. */
  send(_data: string): void {
    // Intentional no-op for Liskov substitutability.
    // Callers needing bidirectional communication should type
    // against WebSocketPipeline directly.
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
  // Connection
  // ============================================

  private createConnection(): void {
    const es = new EventSource(this.config.url, {
      withCredentials: this.config.withCredentials,
    });
    this.es = es;

    es.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState(ConnectionState.Connected);
      this.connectHandler?.();
    };

    // Register listeners for each configured event type
    for (const eventType of this.config.eventTypes) {
      es.addEventListener(eventType, ((event: MessageEvent) => {
        this._lastMessageAt = Date.now();
        this.messageHandler?.(event.data as string);
      }) as EventListener);
    }

    es.onerror = () => {
      // Skip if this is an old EventSource we intentionally abandoned
      if (this.es !== es) return;

      // Close to prevent EventSource's built-in reconnect —
      // we manage reconnect ourselves for consistent backoff/jitter behavior
      es.close();
      this.disconnectHandler?.();

      if (this.intentionallyClosed) {
        this.setState(ConnectionState.Disconnected);
        return;
      }

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
  }
}
