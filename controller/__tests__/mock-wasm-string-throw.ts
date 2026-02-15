/** Mock WASM module whose init throws a non-Error value */
export default function init(): never {
  throw 'string init error'; // eslint-disable-line no-throw-literal
}

export class TestEngine {
  compute(): number {
    return 42;
  }
}
