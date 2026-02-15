import { WasmTaskWorker } from '../WasmTaskWorker';
import type {
  WasmTaskWorkerConfig,
  TaskWorkerToMainMessage,
  TaskWorkerInitMessage,
  TaskWorkerCallMessage,
} from '../WasmTaskWorker';

const mockWorkerInstances: MockWorker[] = [];

class MockWorker {
  onmessage: ((event: MessageEvent<TaskWorkerToMainMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    mockWorkerInstances.push(this);
  }
}

vi.stubGlobal('Worker', MockWorker);

function getConfig(): WasmTaskWorkerConfig {
  return {
    workerUrl: 'test-worker.js',
    wasmUrl: 'test.wasm',
    engineConstructor: 'TestEngine',
  };
}

function getLatestMockWorker(): MockWorker {
  return mockWorkerInstances[mockWorkerInstances.length - 1];
}

function simulateMessage(worker: MockWorker, data: TaskWorkerToMainMessage): void {
  worker.onmessage?.({ data } as MessageEvent<TaskWorkerToMainMessage>);
}

describe('WasmTaskWorker', () => {
  beforeEach(() => {
    mockWorkerInstances.length = 0;
  });

  it('call() rejects when not initialized', async () => {
    const tw = new WasmTaskWorker(getConfig());
    await expect(tw.call('someMethod')).rejects.toThrow('WasmTaskWorker not initialized');
  });

  it('initialize() sends init message to worker', () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();

    const posted = worker.postMessage.mock.calls[0][0] as TaskWorkerInitMessage;
    expect(posted.type).toBe('init');
    expect(posted.wasmUrl).toBe('test.wasm');
    expect(posted.engineConstructor).toBe('TestEngine');

    // Resolve to avoid dangling promise
    simulateMessage(worker, { type: 'ready' });
    return initPromise;
  });

  it('initialize() resolves when worker sends ready', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();

    simulateMessage(worker, { type: 'ready' });
    await expect(initPromise).resolves.toBeUndefined();
    expect(tw.ready).toBe(true);
  });

  it('initialize() rejects when worker sends init-error', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();

    simulateMessage(worker, { type: 'init-error', message: 'WASM load failed' });
    await expect(initPromise).rejects.toThrow('WASM load failed');
  });

  it('initialize() is idempotent (second call returns immediately)', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    expect(tw.ready).toBe(true);
    const instanceCountBefore = mockWorkerInstances.length;

    // Second initialize should resolve immediately without creating a new Worker
    await tw.initialize();
    expect(mockWorkerInstances.length).toBe(instanceCountBefore);
  });

  it('call() sends call message and resolves on result', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    const callPromise = tw.call<number>('compute', { x: 5 });
    expect(tw.pendingCount).toBe(1);

    const callMsg = worker.postMessage.mock.calls[1][0] as TaskWorkerCallMessage;
    expect(callMsg.type).toBe('call');
    expect(callMsg.method).toBe('compute');
    expect(callMsg.args).toEqual({ x: 5 });

    simulateMessage(worker, { type: 'result', id: callMsg.id, value: 25 });

    const result = await callPromise;
    expect(result).toBe(25);
    expect(tw.pendingCount).toBe(0);
  });

  it('call() rejects on error message', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    const callPromise = tw.call('failing');

    const callMsg = worker.postMessage.mock.calls[1][0] as TaskWorkerCallMessage;
    simulateMessage(worker, { type: 'error', id: callMsg.id, message: 'method not found' });

    await expect(callPromise).rejects.toThrow('method not found');
    expect(tw.pendingCount).toBe(0);
  });

  it('pendingCount tracks in-flight calls', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    expect(tw.pendingCount).toBe(0);

    const p1 = tw.call('a');
    expect(tw.pendingCount).toBe(1);

    const p2 = tw.call('b');
    expect(tw.pendingCount).toBe(2);

    const p3 = tw.call('c');
    expect(tw.pendingCount).toBe(3);

    // Resolve the first call
    const callMsg1 = worker.postMessage.mock.calls[1][0] as TaskWorkerCallMessage;
    simulateMessage(worker, { type: 'result', id: callMsg1.id, value: null });
    await p1;
    expect(tw.pendingCount).toBe(2);

    // Resolve remaining
    const callMsg2 = worker.postMessage.mock.calls[2][0] as TaskWorkerCallMessage;
    const callMsg3 = worker.postMessage.mock.calls[3][0] as TaskWorkerCallMessage;
    simulateMessage(worker, { type: 'result', id: callMsg2.id, value: null });
    simulateMessage(worker, { type: 'result', id: callMsg3.id, value: null });
    await p2;
    await p3;
    expect(tw.pendingCount).toBe(0);
  });

  it('dispose() terminates worker, rejects all pending', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    const p1 = tw.call('a');
    const p2 = tw.call('b');

    tw.dispose();

    await expect(p1).rejects.toThrow('WasmTaskWorker disposed');
    await expect(p2).rejects.toThrow('WasmTaskWorker disposed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(tw.pendingCount).toBe(0);
  });

  it('dispose() sets ready to false', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    expect(tw.ready).toBe(true);
    tw.dispose();
    expect(tw.ready).toBe(false);
  });

  it('Worker onerror rejects ready promise and all pending', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();

    // Simulate worker error before ready
    worker.onerror?.({ message: 'Script error' } as ErrorEvent);

    await expect(initPromise).rejects.toThrow('Script error');
  });

  it('unknown message ids are safely ignored', async () => {
    const tw = new WasmTaskWorker(getConfig());
    const initPromise = tw.initialize();
    const worker = getLatestMockWorker();
    simulateMessage(worker, { type: 'ready' });
    await initPromise;

    // Send a result for a non-existent id - should not throw
    simulateMessage(worker, { type: 'result', id: 99999, value: 'ignored' });
    simulateMessage(worker, { type: 'error', id: 88888, message: 'also ignored' });

    // Verify worker is still functional
    expect(tw.ready).toBe(true);
    expect(tw.pendingCount).toBe(0);
  });
});
