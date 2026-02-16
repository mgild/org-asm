import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormState } from '../useFormState';
import { createNotifier } from '../useWasmState';
import type { IFormEngine } from '../../core/interfaces';
import type { FormHandle } from '../useFormEngine';
import type { FormState } from '../../core/types';

function createMockEngine(): IFormEngine & {
  _errors: Map<string, string>;
  _values: Map<string, string>;
  _touched: Set<string>;
  _dirty: Set<string>;
} {
  const values = new Map<string, string>();
  const errors = new Map<string, string>();
  const touched = new Set<string>();
  const dirty = new Set<string>();
  let submitted = false;
  let version = 0;

  return {
    set_field(name: string, value: string) {
      values.set(name, value);
      dirty.add(name);
      version++;
    },
    touch_field(name: string) {
      touched.add(name);
      version++;
    },
    field_value(name: string) { return values.get(name) ?? ''; },
    field_error(name: string) { return errors.get(name) ?? ''; },
    field_touched(name: string) { return touched.has(name); },
    field_dirty(name: string) { return dirty.has(name); },
    is_valid() { return errors.size === 0; },
    is_dirty() { return dirty.size > 0; },
    can_submit() { return errors.size === 0; },
    has_been_submitted() { return submitted; },
    submit() {
      submitted = true;
      for (const k of values.keys()) touched.add(k);
      version++;
      return errors.size === 0;
    },
    reset() {
      values.clear(); errors.clear(); touched.clear(); dirty.clear();
      submitted = false;
      version++;
    },
    data_version() { return version; },
    _errors: errors,
    _values: values,
    _touched: touched,
    _dirty: dirty,
  };
}

function createHandle(engine: IFormEngine): FormHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    setField(name: string, value: string): void {
      engine.set_field(name, value);
      notifier.notify();
    },
    touchField(name: string): void {
      engine.touch_field(name);
      notifier.notify();
    },
    submit(): boolean {
      const result = engine.submit();
      notifier.notify();
      return result;
    },
    reset(): void {
      engine.reset();
      notifier.notify();
    },
    getFieldValue(name: string): string {
      return engine.field_value(name);
    },
    getFormState(): FormState {
      return {
        isValid: engine.is_valid(),
        isDirty: engine.is_dirty(),
        canSubmit: engine.can_submit(),
        hasBeenSubmitted: engine.has_been_submitted(),
        dataVersion: engine.data_version(),
      };
    },
  };
}

describe('useFormState', () => {
  it('returns empty FormState when handle is null', () => {
    const { result } = renderHook(() => useFormState(null));
    expect(result.current).toEqual({
      isValid: false,
      isDirty: false,
      canSubmit: false,
      hasBeenSubmitted: false,
      dataVersion: 0,
    });
  });

  it('returns correct form state (isValid, isDirty, canSubmit, hasBeenSubmitted, dataVersion)', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormState(handle));

    expect(result.current).toEqual({
      isValid: true,
      isDirty: false,
      canSubmit: true,
      hasBeenSubmitted: false,
      dataVersion: 0,
    });
  });

  it('reflects isDirty after setting a field', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormState(handle));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      handle.setField('name', 'Alice');
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects isValid=false when engine has errors', () => {
    const engine = createMockEngine();
    engine._errors.set('email', 'Required');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormState(handle));

    expect(result.current.isValid).toBe(false);
    expect(result.current.canSubmit).toBe(false);
  });

  it('reflects hasBeenSubmitted after submit', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormState(handle));
    expect(result.current.hasBeenSubmitted).toBe(false);

    act(() => {
      handle.submit();
    });

    expect(result.current.hasBeenSubmitted).toBe(true);
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.setField('x', 'y');
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.isDirty).toBe(false);
    expect(result.current.hasBeenSubmitted).toBe(false);
  });
});
