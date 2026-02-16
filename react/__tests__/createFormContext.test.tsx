import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createFormContext } from '../createFormContext';
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

describe('createFormContext', () => {
  it('useForm returns handle from provider', () => {
    const ctx = createFormContext<IFormEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.FormProvider engine={engine}>
        {children}
      </ctx.FormProvider>
    );

    const { result } = renderHook(() => ctx.useForm(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.setField).toBe('function');
    expect(typeof handle.touchField).toBe('function');
    expect(typeof handle.submit).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getFieldValue).toBe('function');
    expect(typeof handle.getFormState).toBe('function');
  });

  it('useField returns field state from provider', () => {
    const ctx = createFormContext<IFormEngine>();
    const engine = createMockEngine();
    engine._values.set('email', 'test@example.com');
    engine._errors.set('email', 'Invalid');
    engine._touched.add('email');
    engine._dirty.add('email');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.FormProvider engine={engine}>
        {children}
      </ctx.FormProvider>
    );

    const { result } = renderHook(() => ctx.useField('email'), { wrapper });

    expect(result.current.value).toBe('test@example.com');
    expect(result.current.error).toBe('Invalid');
    expect(result.current.touched).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.showError).toBe(true);
  });

  it('useFormStatus returns form state from provider', () => {
    const ctx = createFormContext<IFormEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.FormProvider engine={engine}>
        {children}
      </ctx.FormProvider>
    );

    const { result } = renderHook(() => ctx.useFormStatus(), { wrapper });

    expect(result.current).toEqual({
      isValid: true,
      isDirty: false,
      canSubmit: true,
      hasBeenSubmitted: false,
      dataVersion: 0,
    });
  });

  it('useForm throws outside provider', () => {
    const ctx = createFormContext<IFormEngine>();

    expect(() => {
      renderHook(() => ctx.useForm());
    }).toThrow('useForm must be used within a FormProvider');
  });

  it('useField returns empty state outside provider (null handle)', () => {
    const ctx = createFormContext<IFormEngine>();

    const { result } = renderHook(() => ctx.useField('email'));

    expect(result.current).toEqual({
      value: '',
      error: '',
      touched: false,
      dirty: false,
      showError: false,
    });
  });

  it('useFormStatus returns empty state outside provider (null handle)', () => {
    const ctx = createFormContext<IFormEngine>();

    const { result } = renderHook(() => ctx.useFormStatus());

    expect(result.current).toEqual({
      isValid: false,
      isDirty: false,
      canSubmit: false,
      hasBeenSubmitted: false,
      dataVersion: 0,
    });
  });

  it('children render correctly', () => {
    const ctx = createFormContext<IFormEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.FormProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.FormProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('FormProvider works with null engine', () => {
    const ctx = createFormContext<IFormEngine>();

    const { result } = renderHook(() => ctx.useField('email'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.FormProvider engine={null}>
          {children}
        </ctx.FormProvider>
      ),
    });

    expect(result.current).toEqual({
      value: '',
      error: '',
      touched: false,
      dirty: false,
      showError: false,
    });
  });

  it('mutations via useForm propagate to useField and useFormStatus', () => {
    const ctx = createFormContext<IFormEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.FormProvider engine={engine}>
        {children}
      </ctx.FormProvider>
    );

    const { result } = renderHook(
      () => ({
        form: ctx.useForm(),
        field: ctx.useField('name'),
        status: ctx.useFormStatus(),
      }),
      { wrapper },
    );

    expect(result.current.field.value).toBe('');
    expect(result.current.status.isDirty).toBe(false);

    act(() => {
      result.current.form.setField('name', 'Alice');
    });

    expect(result.current.field.value).toBe('Alice');
    expect(result.current.status.isDirty).toBe(true);
  });
});
