import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormEngine } from '../useFormEngine';
import { createNotifier } from '../useWasmState';
import type { IFormEngine } from '../../core/interfaces';

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

describe('useFormEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useFormEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns FormHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.setField).toBe('function');
    expect(typeof handle.touchField).toBe('function');
    expect(typeof handle.submit).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getFieldValue).toBe('function');
    expect(typeof handle.getFormState).toBe('function');
  });

  it('setField calls engine.set_field and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setField('email', 'test@example.com');
    });

    expect(engine.field_value('email')).toBe('test@example.com');
    expect(engine.field_dirty('email')).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('touchField calls engine.touch_field and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.touchField('email');
    });

    expect(engine.field_touched('email')).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('submit calls engine.submit, notifies, and returns result', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    let submitResult: boolean;
    act(() => {
      submitResult = handle.submit();
    });

    expect(submitResult!).toBe(true);
    expect(engine.has_been_submitted()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('submit returns false when engine has errors', () => {
    const engine = createMockEngine();
    engine._errors.set('email', 'Required');
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    let submitResult: boolean;
    act(() => {
      submitResult = handle.submit();
    });

    expect(submitResult!).toBe(false);
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    // Set some state first
    act(() => {
      handle.setField('email', 'test@example.com');
      handle.touchField('email');
      handle.submit();
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.field_value('email')).toBe('');
    expect(engine.field_touched('email')).toBe(false);
    expect(engine.field_dirty('email')).toBe(false);
    expect(engine.has_been_submitted()).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('getFieldValue reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    expect(handle.getFieldValue('email')).toBe('');

    act(() => {
      handle.setField('email', 'hello@world.com');
    });

    expect(handle.getFieldValue('email')).toBe('hello@world.com');
  });

  it('getFormState reads all form-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useFormEngine(engine));
    const handle = result.current!;

    const state = handle.getFormState();
    expect(state).toEqual({
      isValid: true,
      isDirty: false,
      canSubmit: true,
      hasBeenSubmitted: false,
      dataVersion: 0,
    });

    act(() => {
      handle.setField('name', 'Alice');
    });

    const state2 = handle.getFormState();
    expect(state2.isDirty).toBe(true);
    expect(state2.dataVersion).toBeGreaterThan(0);
  });
});
