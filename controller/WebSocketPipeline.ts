/**
 * WebSocketPipeline — Manages WebSocket connections with auto-reconnect.
 *
 * The pipeline connects to a data source and routes raw messages to handlers.
 * It does NOT parse messages — that's the handler's job (separation of concerns).
 *
 * Pattern: WebSocket → raw string → handler(string) → engine methods
 *
 * This decouples the connection lifecycle from data processing.
 * The same pipeline works for any WebSocket data source.
 */

export interface WebSocketConfig {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Protocols to pass to WebSocket constructor */
  protocols?: string[];
}

export type MessageHandler = (data: string) => void;
export type ConnectionHandler = () => void;

export class WebSocketPipeline {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private messageHandler: MessageHandler | null = null;
  private connectHandler: ConnectionHandler | null = null;
  private disconnectHandler: ConnectionHandler | null = null;

  constructor(config: WebSocketConfig) {
    this.config = {
      url: config.url,
      reconnectDelayMs: config.reconnectDelayMs ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
      protocols: config.protocols ?? [],
    };
  }

  /** Set the handler for incoming messages */
  onMessage(handler: MessageHandler): this {
    this.messageHandler = handler;
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

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionallyClosed = false;
    this.createConnection();
  }

  /** Disconnect and stop reconnecting */
  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Only close if OPEN to avoid "closed before connection established" error
    // during React StrictMode unmount-remount cycles
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }

  /** Whether the WebSocket is currently connected */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Update the URL (takes effect on next connect/reconnect) */
  setUrl(url: string): void {
    this.config.url = url;
  }

  private createConnection(): void {
    const ws = new WebSocket(this.config.url, this.config.protocols);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.connectHandler?.();
    };

    ws.onmessage = (event) => {
      this.messageHandler?.(event.data as string);
    };

    ws.onclose = () => {
      // Skip if this is an old ws that we intentionally abandoned (e.g., during StrictMode unmount)
      if (this.ws !== ws) return;
      this.disconnectHandler?.();
      if (!this.intentionallyClosed && this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.reconnectTimeout = setTimeout(() => {
          this.createConnection();
        }, this.config.reconnectDelayMs);
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
