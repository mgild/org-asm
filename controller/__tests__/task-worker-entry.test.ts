import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TaskWorkerToMainMessage, TaskMainToWorkerMessage } from '../WasmTaskWorker';

describe('task-worker-entry', () => {
  const posted: TaskWorkerToMainMessage[] = [];
  let handler: (event: MessageEvent<TaskMainToWorkerMessage>) => Promise<void>;

  beforeEach(async () => {
    posted.length = 0;
    vi.resetModules();

    // Mock self.postMessage to capture output
    vi.stubGlobal('postMessage', (msg: TaskWorkerToMainMessage) => {
      posted.push(msg);
    });

    // Import the module — sets self.onmessage as side effect
    await import('../task-worker-entry');
    handler = (self as unknown as { onmessage: typeof handler }).onmessage;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function send(data: TaskMainToWorkerMessage): Promise<void> {
    return handler({ data } as MessageEvent<TaskMainToWorkerMessage>);
  }

  // ---- Init: success with default function ----
  it('init with valid module sends ready', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    expect(posted).toEqual([{ type: 'ready' }]);
  });

  // ---- Init: default is not a function (skips await wasm.default()) ----
  it('init skips wasm.default() when not a function', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm-no-init', engineConstructor: 'TestEngine' });
    expect(posted).toEqual([{ type: 'ready' }]);
  });

  // ---- Init: missing constructor ----
  it('init with missing constructor sends init-error', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'NonExistentEngine' });
    expect(posted).toEqual([{
      type: 'init-error',
      message: 'Constructor "NonExistentEngine" not found in WASM module',
    }]);
  });

  // ---- Init: import fails (non-existent module) ----
  it('init with bad URL sends init-error', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/nonexistent-module-xyz', engineConstructor: 'X' });
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('init-error');
    expect((posted[0] as { message: string }).message).toBeTruthy();
  });

  // ---- Init: non-Error thrown ----
  it('init with non-Error throw sends String(err)', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm-string-throw', engineConstructor: 'TestEngine' });
    expect(posted).toEqual([{
      type: 'init-error',
      message: 'string init error',
    }]);
  });

  // ---- Call: engine not initialized ----
  it('call before init sends error', async () => {
    await send({ type: 'call', id: 1, method: 'syncMethod', args: null });
    expect(posted).toEqual([{
      type: 'error',
      id: 1,
      message: 'Engine not initialized',
    }]);
  });

  // ---- Call: sync method ----
  it('call sync method sends result', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 1, method: 'syncMethod', args: { x: 42 } });
    expect(posted).toEqual([{ type: 'result', id: 1, value: { x: 42 } }]);
  });

  // ---- Call: async method ----
  it('call async method sends result', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 2, method: 'asyncMethod', args: 'hello' });
    // async result comes via .then — need to flush microtask queue
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(posted).toEqual([{ type: 'result', id: 2, value: 'hello' }]);
  });

  // ---- Call: method not found ----
  it('call non-existent method sends error', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 3, method: 'noSuchMethod', args: null });
    expect(posted).toEqual([{
      type: 'error',
      id: 3,
      message: 'Method "noSuchMethod" not found on engine',
    }]);
  });

  // ---- Call: sync method throws Error ----
  it('call sync method that throws Error sends error', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 4, method: 'throwMethod', args: null });
    expect(posted).toEqual([{
      type: 'error',
      id: 4,
      message: 'sync engine error',
    }]);
  });

  // ---- Call: async method rejects with Error ----
  it('call async method that rejects with Error sends error', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 5, method: 'asyncThrowMethod', args: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(posted).toEqual([{
      type: 'error',
      id: 5,
      message: 'async engine error',
    }]);
  });

  // ---- Call: sync method throws non-Error ----
  it('call sync method that throws non-Error sends String(err)', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 6, method: 'throwNonError', args: null });
    expect(posted).toEqual([{
      type: 'error',
      id: 6,
      message: 'raw string error',
    }]);
  });

  // ---- Call: async method rejects with non-Error ----
  it('call async method that rejects with non-Error sends String(err)', async () => {
    await send({ type: 'init', wasmUrl: './__tests__/mock-wasm', engineConstructor: 'TestEngine' });
    posted.length = 0;

    await send({ type: 'call', id: 7, method: 'asyncThrowNonError', args: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(posted).toEqual([{
      type: 'error',
      id: 7,
      message: 'raw async string error',
    }]);
  });
});
