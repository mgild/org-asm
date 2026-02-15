/**
 * connectionTypes — Shared interface for connection pipelines.
 *
 * IConnectionPipeline is the read-side contract that both WebSocketPipeline
 * and SSEPipeline implement. Code that only needs to receive messages and
 * track connection state can type against this interface, making the transport
 * swappable without changing downstream logic.
 *
 * Handler types are defined here and re-exported from WebSocketPipeline
 * for backward compatibility.
 */

import type { ConnectionState, ConnectionError } from '../core/types';

export type { ConnectionState, ConnectionError };

export type MessageHandler = (data: string) => void;
export type ConnectionHandler = () => void;
export type StateChangeHandler = (state: ConnectionState) => void;
export type ErrorHandler = (error: ConnectionError) => void;

export interface IConnectionPipeline {
  /** Set the handler for incoming text messages */
  onMessage(handler: MessageHandler): this;

  /** Set the handler for connection open */
  onConnect(handler: ConnectionHandler): this;

  /** Set the handler for connection close */
  onDisconnect(handler: ConnectionHandler): this;

  /** Set the handler for state transitions */
  onStateChange(handler: StateChangeHandler): this;

  /** Set the handler for connection errors */
  onError(handler: ErrorHandler): this;

  /** Connect to the data source */
  connect(): void;

  /** Disconnect and stop reconnecting */
  disconnect(): void;

  /** Send a text message (no-op for read-only transports like SSE) */
  send(data: string): void;

  /** Update the URL (takes effect on next connect/reconnect) */
  setUrl(url: string): void;

  /** Whether the pipeline is currently connected */
  readonly connected: boolean;

  /** Current connection state */
  readonly state: ConnectionState;

  /** Whether the connection is stale (no message within threshold) */
  readonly stale: boolean;

  /** Timestamp of last received message (0 if none) */
  readonly lastMessageTime: number;
}
