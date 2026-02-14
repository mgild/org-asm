/**
 * WasmBridge — Manages WASM module initialization lifecycle.
 *
 * The bridge ensures WASM is initialized exactly once (idempotent).
 * It provides both async (for top-level await) and callback patterns.
 *
 * Pattern: Import WASM → await init() → create engine instance → ready
 *
 * Usage:
 *   const bridge = new WasmBridge(() => import('../generated/pkg/my_engine'));
 *   await bridge.initialize();
 *   const engine = bridge.createEngine('MyEngine');
 */

export type WasmInitFn = () => Promise<unknown>;
export type WasmModule = Record<string, unknown>;

export class WasmBridge {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private wasmModule: WasmModule | null = null;
  private initFn: WasmInitFn;

  /**
   * @param initFn - Function that imports and initializes the WASM module.
   *   Should call the default export (init function) from wasm-pack output.
   *   Example: () => import('../generated/pkg/my_engine').then(m => m.default())
   */
  constructor(initFn: WasmInitFn) {
    this.initFn = initFn;
  }

  /** Initialize the WASM module. Idempotent — safe to call multiple times. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.initFn().then((mod) => {
        this.wasmModule = mod as WasmModule;
        this.initialized = true;
      });
    }
    await this.initPromise;
  }

  /** Whether WASM is initialized and ready to use */
  get ready(): boolean {
    return this.initialized;
  }

  /** Get the raw WASM module exports */
  get module(): WasmModule {
    if (!this.initialized || !this.wasmModule) {
      throw new Error('WasmBridge: WASM not initialized. Call initialize() first.');
    }
    return this.wasmModule;
  }

  /**
   * Create an engine instance by constructor name.
   * The constructor must be exported from the WASM module via #[wasm_bindgen(constructor)].
   */
  createEngine<T>(constructorName: string): T {
    const Ctor = this.module[constructorName] as { new(): T } | undefined;
    if (!Ctor) {
      throw new Error(`WasmBridge: Constructor "${constructorName}" not found in WASM module.`);
    }
    return new Ctor();
  }

  /**
   * Get the WebAssembly.Memory from the initialized module.
   * Required for zero-copy array views into WASM linear memory.
   */
  getMemory(): WebAssembly.Memory {
    const mod = this.module;
    const mem = (mod as { memory?: WebAssembly.Memory }).memory;
    if (!mem) {
      throw new Error('WasmBridge: No memory export found on WASM module.');
    }
    return mem;
  }
}

// ============================================
// Zero-copy helpers (standalone, no WasmBridge required)
// ============================================

/**
 * Create a tick adapter that reads frames from WASM linear memory (zero-copy).
 *
 * The engine's tick() writes into a persistent internal buffer (no Vec allocation).
 * This adapter creates a Float64Array VIEW directly into that buffer — no copy.
 * The view is recreated each frame to handle potential WASM memory growth.
 *
 * Plugs directly into AnimationLoop which expects { tick(nowMs): Float64Array }.
 *
 * Usage:
 *   const wasm = await init();
 *   const engine = new MyEngine();
 *   const tickSource = zeroCopyTickAdapter(engine, wasm.memory, FRAME_SIZE);
 *   const loop = new AnimationLoop(tickSource);
 */
export function zeroCopyTickAdapter(
  engine: { tick(nowMs: number): void; frame_ptr(): number },
  memory: WebAssembly.Memory,
  frameSize: number,
): { tick(nowMs: number): Float64Array } {
  return {
    tick(nowMs: number): Float64Array {
      engine.tick(nowMs);
      return new Float64Array(memory.buffer, engine.frame_ptr(), frameSize);
    },
  };
}

/**
 * Create a lazy Float64Array view factory for WASM linear memory.
 *
 * Returns a function that creates a fresh zero-copy view on each call.
 * Views must be recreated because memory.buffer can be detached after
 * WASM memory growth (Vec push, etc.).
 *
 * Usage:
 *   const getTimestamps = zeroCopyArrayView(
 *     () => engine.timestamps_ptr(),
 *     () => engine.timestamps_len(),
 *     wasm.memory,
 *   );
 *   const ts = getTimestamps(); // zero-copy Float64Array view
 */
export function zeroCopyArrayView(
  ptrFn: () => number,
  lenFn: () => number,
  memory: WebAssembly.Memory,
): () => Float64Array {
  return () => new Float64Array(memory.buffer, ptrFn(), lenFn());
}
