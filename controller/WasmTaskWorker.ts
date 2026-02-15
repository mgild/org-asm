/**
 * WasmTaskWorker — Promise-based worker for one-off WASM computation.
 *
 * Unlike WorkerBridge (frame-oriented with SharedArrayBuffer + tick interval),
 * WasmTaskWorker is request/response: send a method name + args, get a Promise back.
 * Similar to ResponseRegistry but for workers instead of WebSocket.
 *
 * Usage:
 *   const worker = new WasmTaskWorker({
 *     workerUrl: new URL('./compute-worker.ts', import.meta.url),
 *     wasmUrl: './pkg/my_engine_bg.wasm',
 *     engineConstructor: 'MyEngine',
 *   });
 *   await worker.initialize();
 *
 *   const result = await worker.call('optimize', { data });
 *   worker.dispose();
 */

// ============================================
// Message types (Main -> Worker)
// ============================================

export interface TaskWorkerInitMessage {
  type: 'init';
  wasmUrl: string;
  engineConstructor: string;
}

export interface TaskWorkerCallMessage {
  type: 'call';
  id: number;
  method: string;
  args: unknown;
}

export type TaskMainToWorkerMessage =
  | TaskWorkerInitMessage
  | TaskWorkerCallMessage;

// ============================================
// Message types (Worker -> Main)
// ============================================

export interface TaskWorkerReadyMessage {
  type: 'ready';
}

export interface TaskWorkerResultMessage {
  type: 'result';
  id: number;
  value: unknown;
}

export interface TaskWorkerErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export interface TaskWorkerInitErrorMessage {
  type: 'init-error';
  message: string;
}

export type TaskWorkerToMainMessage =
  | TaskWorkerReadyMessage
  | TaskWorkerResultMessage
  | TaskWorkerErrorMessage
  | TaskWorkerInitErrorMessage;

// ============================================
// Config
// ============================================

export interface WasmTaskWorkerConfig {
  /** URL of the task worker entry script */
  workerUrl: URL | string;
  /** URL of the WASM module */
  wasmUrl: string;
  /** Name of the engine constructor exported from WASM */
  engineConstructor: string;
}

// ============================================
// WasmTaskWorker
// ============================================

export class WasmTaskWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private config: WasmTaskWorkerConfig;
  private _ready = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;

  constructor(config: WasmTaskWorkerConfig) {
    this.config = config;
  }

  /** Spawn the worker, load WASM, and wait for ready. */
  async initialize(): Promise<void> {
    if (this._ready) return;

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.worker = new Worker(this.config.workerUrl, { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<TaskWorkerToMainMessage>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      const err = new Error(event.message);
      this.readyReject?.(err);
      this.rejectAll(err);
    };

    const initMsg: TaskWorkerInitMessage = {
      type: 'init',
      wasmUrl: this.config.wasmUrl,
      engineConstructor: this.config.engineConstructor,
    };
    this.worker.postMessage(initMsg);

    return readyPromise;
  }

  /** Call a method on the WASM engine. Returns a typed Promise. */
  call<T = unknown>(method: string, args?: unknown): Promise<T> {
    if (!this._ready || !this.worker) {
      return Promise.reject(new Error('WasmTaskWorker not initialized'));
    }

    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });

    const msg: TaskWorkerCallMessage = {
      type: 'call',
      id,
      method,
      args: args ?? null,
    };
    this.worker.postMessage(msg);

    return promise;
  }

  /** Whether the worker is initialized and ready. */
  get ready(): boolean {
    return this._ready;
  }

  /** Number of in-flight calls. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Terminate the worker and reject all pending calls. */
  dispose(): void {
    this.rejectAll(new Error('WasmTaskWorker disposed'));
    this.worker?.terminate();
    this.worker = null;
    this._ready = false;
  }

  private handleMessage(msg: TaskWorkerToMainMessage): void {
    switch (msg.type) {
      case 'ready':
        this._ready = true;
        this.readyResolve?.();
        break;

      case 'init-error':
        this.readyReject?.(new Error(msg.message));
        break;

      case 'result': {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve(msg.value);
        }
        break;
      }

      case 'error': {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.reject(new Error(msg.message));
        }
        break;
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const [, entry] of this.pending) {
      entry.reject(err);
    }
    this.pending.clear();
  }
}
