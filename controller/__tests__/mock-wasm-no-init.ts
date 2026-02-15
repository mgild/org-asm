/** Mock WASM module without a default init function */
export const notAFunction = 42;
export default 'not-a-function';

export class TestEngine {
  compute(): number {
    return 42;
  }
}
