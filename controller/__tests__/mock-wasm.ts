/** Mock WASM module for testing task-worker-entry */
export default function init(): void {
  // no-op WASM init
}

export class TestEngine {
  syncMethod(args: unknown): unknown {
    return args;
  }

  asyncMethod(args: unknown): Promise<unknown> {
    return Promise.resolve(args);
  }

  throwMethod(): never {
    throw new Error('sync engine error');
  }

  asyncThrowMethod(): Promise<never> {
    return Promise.reject(new Error('async engine error'));
  }

  throwNonError(): unknown {
    throw 'raw string error'; // eslint-disable-line no-throw-literal
  }

  asyncThrowNonError(): Promise<never> {
    return Promise.reject('raw async string error'); // eslint-disable-line prefer-promise-reject-errors
  }
}
