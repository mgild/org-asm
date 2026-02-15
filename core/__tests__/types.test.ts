import {
  INGEST_DATA_UPDATED,
  INGEST_STATS_UPDATED,
  ConnectionState,
} from '../types';
import type { WasmResult, WasmOk, WasmErr } from '../types';

describe('runtime constants', () => {
  it('INGEST_DATA_UPDATED is 1', () => {
    expect(INGEST_DATA_UPDATED).toBe(1);
  });

  it('INGEST_STATS_UPDATED is 2', () => {
    expect(INGEST_STATS_UPDATED).toBe(2);
  });

  it('bitmask composition works', () => {
    const both = INGEST_DATA_UPDATED | INGEST_STATS_UPDATED;
    expect(both).toBe(3);
    expect(both & INGEST_DATA_UPDATED).toBeTruthy();
    expect(both & INGEST_STATS_UPDATED).toBeTruthy();
  });
});

describe('ConnectionState enum', () => {
  it('has correct string values', () => {
    expect(ConnectionState.Disconnected).toBe('disconnected');
    expect(ConnectionState.Connecting).toBe('connecting');
    expect(ConnectionState.Connected).toBe('connected');
    expect(ConnectionState.Reconnecting).toBe('reconnecting');
  });

  it('has exactly 4 members', () => {
    const values = Object.values(ConnectionState);
    expect(values).toHaveLength(4);
  });
});

describe('WasmResult<T>', () => {
  it('WasmOk narrows correctly', () => {
    const result: WasmResult<number> = { ok: true, value: 42 };
    if (result.ok) {
      expect(result.value).toBe(42);
    } else {
      throw new Error('Expected ok');
    }
  });

  it('WasmErr narrows correctly', () => {
    const result: WasmResult<number> = { ok: false, error: 'fail' };
    if (!result.ok) {
      expect(result.error).toBe('fail');
    } else {
      throw new Error('Expected err');
    }
  });

  it('type guard pattern works', () => {
    function isOk<T>(r: WasmResult<T>): r is WasmOk<T> { return r.ok; }
    function isErr<T>(r: WasmResult<T>): r is WasmErr { return !r.ok; }

    const ok: WasmResult<string> = { ok: true, value: 'hello' };
    const err: WasmResult<string> = { ok: false, error: 'bad' };

    expect(isOk(ok)).toBe(true);
    expect(isErr(err)).toBe(true);
    if (isOk(ok)) expect(ok.value).toBe('hello');
    if (isErr(err)) expect(err.error).toBe('bad');
  });

  it('works with object generic', () => {
    const result: WasmResult<{ name: string }> = { ok: true, value: { name: 'Alice' } };
    if (result.ok) expect(result.value.name).toBe('Alice');
  });
});
