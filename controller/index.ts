// Connection types (shared interface)
export type { IConnectionPipeline, MessageHandler, ConnectionHandler, StateChangeHandler, ErrorHandler } from './connectionTypes';

// WebSocket pipeline
export { WebSocketPipeline, ConnectionState } from './WebSocketPipeline';
export type { WebSocketConfig, BinaryMessageHandler, ConnectionError } from './WebSocketPipeline';

// SSE pipeline
export { SSEPipeline } from './SSEPipeline';
export type { SSEConfig } from './SSEPipeline';

// WASM bridge (non-worker path)
export { WasmBridge, zeroCopyTickAdapter, zeroCopyArrayView } from './WasmBridge';

// Worker bridge (off-main-thread path)
export { WorkerBridge } from './WorkerBridge';
export type { WorkerBridgeConfig, MainToWorkerMessage, WorkerToMainMessage } from './WorkerBridge';

// Shared buffer tick sources
export {
  sharedBufferTickSource,
  sharedBufferFlatBufferTickSource,
  withSequenceTracking,
  computeBufferSize,
  computeFlatBufferBufferSize,
} from './SharedBufferTickSource';

// Input + parsing + commands
export { InputController } from './InputController';
export type { ActionHandlers, ActionEndCallback } from './InputController';
export { MessageParser, WasmIngestParser, BinaryFrameParser } from './MessageParser';
export type { EngineDataTarget } from './MessageParser';
export { CommandBuilder, CommandSender } from './CommandSender';
export { ResponseRegistry } from './ResponseRegistry';
export { SubscriptionManager } from './SubscriptionManager';
export type { BinaryMiddleware } from './WebSocketPipeline';

// Task worker (request/response path)
export { WasmTaskWorker } from './WasmTaskWorker';
export type {
  WasmTaskWorkerConfig,
  TaskMainToWorkerMessage,
  TaskWorkerToMainMessage,
} from './WasmTaskWorker';
