import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormField } from '../useFormField';
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

describe('useFormField', () => {
  it('returns empty FieldState when handle is null', () => {
    const { result } = renderHook(() => useFormField(null, 'email'));
    expect(result.current).toEqual({
      value: '',
      error: '',
      touched: false,
      dirty: false,
      showError: false,
    });
  });

  it('returns correct field state (value, error, touched, dirty)', () => {
    const engine = createMockEngine();
    engine._values.set('email', 'test@example.com');
    engine._errors.set('email', 'Invalid');
    engine._touched.add('email');
    engine._dirty.add('email');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormField(handle, 'email'));

    expect(result.current.value).toBe('test@example.com');
    expect(result.current.error).toBe('Invalid');
    expect(result.current.touched).toBe(true);
    expect(result.current.dirty).toBe(true);
  });

  it('showError is true when touched=true AND error is non-empty', () => {
    const engine = createMockEngine();
    engine._errors.set('email', 'Required');
    engine._touched.add('email');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormField(handle, 'email'));

    expect(result.current.showError).toBe(true);
  });

  it('showError is true when submitted=true AND error is non-empty', () => {
    const engine = createMockEngine();
    engine._values.set('email', '');
    engine._errors.set('email', 'Required');
    const handle = createHandle(engine);

    // Submit the form to set submitted=true
    act(() => {
      handle.submit();
    });

    const { result } = renderHook(() => useFormField(handle, 'email'));

    expect(result.current.showError).toBe(true);
    expect(engine.has_been_submitted()).toBe(true);
  });

  it('showError is false when error is empty even if touched', () => {
    const engine = createMockEngine();
    engine._touched.add('email');
    // No error set — field_error returns ''
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormField(handle, 'email'));

    expect(result.current.touched).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.showError).toBe(false);
  });

  it('showError is false when error is empty even if submitted', () => {
    const engine = createMockEngine();
    // No errors on any field
    const handle = createHandle(engine);

    act(() => {
      handle.submit();
    });

    const { result } = renderHook(() => useFormField(handle, 'email'));

    expect(engine.has_been_submitted()).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.showError).toBe(false);
  });

  it('showError is false when not touched and not submitted, even with error', () => {
    const engine = createMockEngine();
    engine._errors.set('email', 'Required');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormField(handle, 'email'));

    expect(result.current.touched).toBe(false);
    expect(result.current.error).toBe('Required');
    expect(result.current.showError).toBe(false);
  });

  it('updates on notify (re-renders with new value)', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useFormField(handle, 'email'));
    expect(result.current.value).toBe('');

    act(() => {
      handle.setField('email', 'new@value.com');
    });

    expect(result.current.value).toBe('new@value.com');
    expect(result.current.dirty).toBe(true);
  });
});
