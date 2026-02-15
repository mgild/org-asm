/**
 * WorkerBridge — Main-thread coordinator for off-main-thread WASM computation.
 *
 * Spawns a Web Worker, sends it a SharedArrayBuffer, and manages the lifecycle
 * of the worker. The worker runs the WASM engine on its own timer and writes
 * frame data into the SAB. The main thread reads the latest frame on each
 * requestAnimationFrame tick via SharedBufferTickSource.
 *
 * Architecture:
 *   Main Thread                         Worker Thread
 *   ───────────                         ─────────────
 *   AnimationLoop                       WASM Engine
 *     reads SharedArrayBuffer  ←────→  writes SharedArrayBuffer
 *     rAF loop                          setInterval (~60fps)
 *     consumers (DOM/React)
 *
 *   bridge.postInput()  ──postMessage──→  engine.openAction()
 *   ws.onMessage()      ──postMessage──→  engine.ingest_message()
 *
 * Message protocol (typed discriminated unions):
 *   Main→Worker: init, start, stop, input, data, binary-data, configure
 *   Worker→Main: ready, started, stopped, error
 *
 * Usage:
 *   const bridge = new WorkerBridge({
 *     workerUrl: new URL('./my-worker.ts', import.meta.url),
 *     frameSize: 39,
 *   });
 *   await bridge.initialize('my-engine.wasm', 'MyEngine');
 *   const source = sharedBufferTickSource(bridge.buffer, 39);
 *   const loop = new AnimationLoop(source);
 *   bridge.start();
 *   loop.start();
 */

import { computeBufferSize, computeFlatBufferBufferSize } from './SharedBufferTickSource';

// ============================================
// Message types (Main → Worker)
// ============================================

export interface InitMessage {
  type: 'init';
  buffer: SharedArrayBuffer;
  wasmUrl: string;
  engineConstructor: string;
  tickIntervalMs: number;
}

export interface StartMessage {
  type: 'start';
}

export interface StopMessage {
  type: 'stop';
}

export interface InputMessage {
  type: 'input';
  action: string;
  params: Record<string, unknown>;
}

export interface DataMessage {
  type: 'data';
  payload: string;
}

export interface BinaryDataMessage {
  type: 'binary-data';
  payload: ArrayBuffer;
}

export interface ConfigureMessage {
  type: 'configure';
  key: string;
  value: number;
}

export type MainToWorkerMessage =
  | InitMessage
  | StartMessage
  | StopMessage
  | InputMessage
  | DataMessage
  | BinaryDataMessage
  | ConfigureMessage;

// ============================================
// Message types (Worker → Main)
// ============================================

export interface ReadyMessage {
  type: 'ready';
}

export interface StartedMessage {
  type: 'started';
}

export interface StoppedMessage {
  type: 'stopped';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerToMainMessage =
  | ReadyMessage
  | StartedMessage
  | StoppedMessage
  | ErrorMessage;

// ============================================
// Config
// ============================================

export interface WorkerBridgeConfig {
  /** URL of the worker script */
  workerUrl: URL | string;
  /** Number of Float64 elements in the frame (for Float64Array mode) */
  frameSize: number;
  /** Byte count for FlatBuffer mode. If set, frameSize is ignored for buffer sizing. */
  frameSizeBytes?: number;
  /** Worker tick interval in ms (default: 16 ≈ 60fps) */
  tickIntervalMs?: number;
}

// ============================================
// WorkerBridge
// ============================================

export class WorkerBridge {
  private worker: Worker | null = null;
  private _buffer: SharedArrayBuffer;
  private _ready = false;
  private _error: Error | null = null;
  private config: Required<Omit<WorkerBridgeConfig, 'frameSizeBytes'>> & { frameSizeBytes?: number };
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;

  constructor(config: WorkerBridgeConfig) {
    this.config = {
      workerUrl: config.workerUrl,
      frameSize: config.frameSize,
      frameSizeBytes: config.frameSizeBytes,
      tickIntervalMs: config.tickIntervalMs ?? 16,
    };

    // Allocate SharedArrayBuffer
    const size = config.frameSizeBytes != null
      ? computeFlatBufferBufferSize(config.frameSizeBytes)
      : computeBufferSize(config.frameSize);
    this._buffer = new SharedArrayBuffer(size);
  }

  /**
   * Initialize the worker: spawn it, send the SAB + WASM config,
   * and wait for the 'ready' message.
   */
  async initialize(wasmUrl: string, engineConstructor: string): Promise<void> {
    if (this._ready) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.worker = new Worker(this.config.workerUrl, { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          this._ready = true;
          this.readyResolve?.();
          break;
        case 'error':
          this._error = new Error(msg.message);
          this.readyReject?.(this._error);
          break;
      }
    };

    this.worker.onerror = (event) => {
      this._error = new Error(event.message);
      this.readyReject?.(this._error);
    };

    const initMsg: InitMessage = {
      type: 'init',
      buffer: this._buffer,
      wasmUrl,
      engineConstructor,
      tickIntervalMs: this.config.tickIntervalMs,
    };
    this.worker.postMessage(initMsg);

    return this.readyPromise;
  }

  /** Start the worker's tick loop */
  start(): void {
    this.post({ type: 'start' });
  }

  /** Stop the worker's tick loop */
  stop(): void {
    this.post({ type: 'stop' });
  }

  /** Send an input action to the engine (e.g., openAction) */
  postInput(action: string, params: Record<string, unknown> = {}): void {
    this.post({ type: 'input', action, params });
  }

  /** Send a text data payload to the engine (e.g., ingest_message) */
  postData(payload: string): void {
    this.post({ type: 'data', payload });
  }

  /** Send binary data to the engine. The ArrayBuffer is transferred (zero-copy). */
  postBinaryData(payload: ArrayBuffer): void {
    this.worker?.postMessage(
      { type: 'binary-data', payload } satisfies BinaryDataMessage,
      [payload],
    );
  }

  /** Send a configuration update to the engine */
  postConfigure(key: string, value: number): void {
    this.post({ type: 'configure', key, value });
  }

  /** The SharedArrayBuffer shared with the worker */
  get buffer(): SharedArrayBuffer {
    return this._buffer;
  }

  /** Whether the worker is initialized and ready */
  get ready(): boolean {
    return this._ready;
  }

  /** The last error from the worker, if any */
  get error(): Error | null {
    return this._error;
  }

  /** Terminate the worker and release resources */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this._ready = false;
  }

  private post(msg: MainToWorkerMessage): void {
    this.worker?.postMessage(msg);
  }
}
