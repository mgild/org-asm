/**
 * worker-entry.ts — Reference Worker script template.
 *
 * Users copy this file and customize it for their specific WASM engine.
 * It shows the standard pattern:
 *   1. Receive SharedArrayBuffer and init config from the main thread
 *   2. Dynamically import and initialize WASM
 *   3. Create the engine instance
 *   4. Run a setInterval tick loop that writes frames to the SAB
 *   5. Handle input, data, and configure messages
 *
 * SharedArrayBuffer layout (header):
 *   Bytes 0-7:   sequence number (Float64)
 *   Bytes 8-15:  timestamp (Float64)
 *   Bytes 16-19: frame length in bytes (Uint32, FlatBuffer mode only)
 *   Bytes 20+:   frame data
 *
 * IMPORTANT: This file is a TEMPLATE. Copy it to your project and modify:
 *   - The WASM import path and init function
 *   - The engine constructor and method calls
 *   - The frame writing logic (Float64Array vs FlatBuffer)
 *
 * Usage (in your bundler config, e.g., Vite):
 *   new Worker(new URL('./my-worker.ts', import.meta.url), { type: 'module' })
 */

import type { MainToWorkerMessage, WorkerToMainMessage } from './WorkerBridge';

// ============================================
// SAB header offsets
// ============================================

const SEQ_OFFSET = 0;            // Float64 index 0 → byte 0
const TS_OFFSET = 1;             // Float64 index 1 → byte 8
const FRAME_LENGTH_BYTE = 16;    // Uint32 at byte 16
const HEADER_FLOAT64S = 3;       // Frame data starts at Float64 index 3 (byte 24)

// ============================================
// State
// ============================================

let buffer: SharedArrayBuffer | null = null;
let headerView: Float64Array | null = null;
let frameView: Float64Array | null = null;
let frameLengthView: Uint32Array | null = null;
let engine: Record<string, unknown> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let sequence = 0;

// ============================================
// Message handling
// ============================================

function post(msg: WorkerToMainMessage): void {
  (self as unknown as { postMessage(msg: WorkerToMainMessage): void }).postMessage(msg);
}

self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      try {
        buffer = msg.buffer;
        headerView = new Float64Array(buffer, 0, HEADER_FLOAT64S);
        frameLengthView = new Uint32Array(buffer, FRAME_LENGTH_BYTE, 1);

        // ---- CUSTOMIZE: Import and initialize your WASM module ----
        // Example:
        //   const wasm = await import('./pkg/my_engine.js');
        //   await wasm.default(msg.wasmUrl);
        //   engine = new wasm[msg.engineConstructor]();
        //
        // Dynamic import approach (works with bundlers that support it):
        const wasm = await import(/* @vite-ignore */ msg.wasmUrl);
        if (typeof wasm.default === 'function') {
          await wasm.default();
        }
        const Ctor = wasm[msg.engineConstructor];
        if (!Ctor) {
          throw new Error(`Constructor "${msg.engineConstructor}" not found in WASM module`);
        }
        engine = new Ctor() as Record<string, unknown>;

        // ---- CUSTOMIZE: Set up frame view for Float64Array mode ----
        // For Float64Array mode, create a view into the data region:
        //   const frameSize = 39; // your frame size
        //   frameView = new Float64Array(buffer, HEADER_FLOAT64S * 8, frameSize);
        //
        // For FlatBuffer mode, you'll write bytes directly (see tick handler below)

        post({ type: 'ready' });
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'start': {
      if (!engine || !headerView) break;
      const intervalMs = 16; // ~60fps, or use msg from init

      tickInterval = setInterval(() => {
        if (!engine || !headerView) return;
        const nowMs = Date.now();

        // ---- CUSTOMIZE: Call your engine's tick ----
        // Float64Array mode:
        //   (engine as Record<string, Function>).tick(nowMs);
        //   const ptr = (engine as Record<string, Function>).frame_ptr();
        //   const len = (engine as Record<string, Function>).frame_len();
        //   // Copy frame data from WASM memory to SAB
        //   // (WASM linear memory can't be a SharedArrayBuffer)
        //   const wasmView = new Float64Array(wasmMemory.buffer, ptr, frameSize);
        //   frameView!.set(wasmView);
        //
        // FlatBuffer mode:
        //   (engine as Record<string, Function>).tick(nowMs);
        //   const ptr = (engine as Record<string, Function>).frame_ptr();
        //   const len = (engine as Record<string, Function>).frame_len();
        //   const bytes = new Uint8Array(wasmMemory.buffer, ptr, len);
        //   const dataView = new Uint8Array(buffer!, 20, len);
        //   dataView.set(bytes);
        //   Atomics.store(frameLengthView!, 0, len);

        // Update header
        sequence++;
        headerView![SEQ_OFFSET] = sequence;
        headerView![TS_OFFSET] = nowMs;
      }, intervalMs);

      post({ type: 'started' });
      break;
    }

    case 'stop': {
      if (tickInterval !== null) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      post({ type: 'stopped' });
      break;
    }

    case 'input': {
      // ---- CUSTOMIZE: Route to your engine's action methods ----
      // Example: (engine as Record<string, Function>).openAction(msg.action, JSON.stringify(msg.params), Date.now());
      break;
    }

    case 'data': {
      // ---- CUSTOMIZE: Route to your engine's ingest method ----
      // Example: (engine as Record<string, Function>).ingest_message(msg.payload, Date.now());
      break;
    }

    case 'binary-data': {
      // ---- CUSTOMIZE: Route to your engine's binary ingest ----
      // Example: (engine as Record<string, Function>).ingest_frame(new Uint8Array(msg.payload));
      break;
    }

    case 'configure': {
      // ---- CUSTOMIZE: Route to your engine's configure method ----
      // Example: (engine as Record<string, Function>).configure(msg.key, msg.value);
      break;
    }
  }
};
