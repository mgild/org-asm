/**
 * task-worker-entry.ts — Generic Worker entry for one-off WASM computation.
 *
 * Counterpart to WasmTaskWorker. Loads a WASM module, creates an engine
 * instance, and dispatches method calls. Unlike worker-entry.ts (frame-oriented
 * with SharedArrayBuffer + tick interval), this is pure request/response.
 *
 * Protocol:
 *   Main -> Worker: init (load WASM), call (invoke method)
 *   Worker -> Main: ready, result, error, init-error
 *
 * IMPORTANT: This file is a TEMPLATE. Copy it to your project and modify:
 *   - The WASM import path and init function
 *   - The engine constructor
 *
 * Usage (in your bundler config, e.g., Vite):
 *   new Worker(new URL('./my-task-worker.ts', import.meta.url), { type: 'module' })
 */

import type {
  TaskMainToWorkerMessage,
  TaskWorkerToMainMessage,
} from './WasmTaskWorker';

// ============================================
// State
// ============================================

let engine: Record<string, unknown> | null = null;

// ============================================
// Message handling
// ============================================

function post(msg: TaskWorkerToMainMessage): void {
  (self as unknown as { postMessage(msg: TaskWorkerToMainMessage): void }).postMessage(msg);
}

self.onmessage = async (event: MessageEvent<TaskMainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      try {
        // ---- CUSTOMIZE: Import and initialize your WASM module ----
        const wasm = await import(/* @vite-ignore */ msg.wasmUrl);
        if (typeof wasm.default === 'function') {
          await wasm.default();
        }
        const Ctor = wasm[msg.engineConstructor];
        if (!Ctor) {
          throw new Error(`Constructor "${msg.engineConstructor}" not found in WASM module`);
        }
        engine = new Ctor() as Record<string, unknown>;
        post({ type: 'ready' });
      } catch (err) {
        post({ type: 'init-error', message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'call': {
      if (!engine) {
        post({ type: 'error', id: msg.id, message: 'Engine not initialized' });
        break;
      }

      try {
        const method = engine[msg.method];
        if (typeof method !== 'function') {
          throw new Error(`Method "${msg.method}" not found on engine`);
        }

        const result = method.call(engine, msg.args);

        // Support both sync and async engine methods
        if (result && typeof result === 'object' && 'then' in result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(
            (value) => post({ type: 'result', id: msg.id, value }),
            (err) => post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }),
          );
        } else {
          post({ type: 'result', id: msg.id, value: result });
        }
      } catch (err) {
        post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
  }
};
