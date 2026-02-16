/**
 * createFormContext — Context factory for sharing a FormHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createWasmContext pattern: create once per form engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { FormProvider, useForm, useField, useFormStatus } = createFormContext<MyFormEngine>();
 *
 *   // App.tsx
 *   <FormProvider engine={engine}>
 *     <MyForm />
 *   </FormProvider>
 *
 *   // Any descendant
 *   const { setField, submit } = useForm();
 *   const { value, showError, error } = useField('email');
 *   const { canSubmit } = useFormStatus();
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useFormEngine } from './useFormEngine';
import { useFormField } from './useFormField';
import { useFormState } from './useFormState';
import type { FormHandle } from './useFormEngine';
import type { IFormEngine } from '../core/interfaces';
import type { FieldState, FormState } from '../core/types';

export interface FormProviderProps<E extends IFormEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface FormContextValue<E extends IFormEngine> {
  FormProvider: (props: FormProviderProps<E>) => ReactNode;
  useForm: () => FormHandle<E>;
  useField: (name: string) => FieldState;
  useFormStatus: () => FormState;
}

export function createFormContext<E extends IFormEngine>(): FormContextValue<E> {
  const HandleCtx = createContext<FormHandle<E> | null>(null);

  function useForm(): FormHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useForm must be used within a FormProvider');
    }
    return ctx;
  }

  function useField(name: string): FieldState {
    const ctx = useContext(HandleCtx);
    return useFormField(ctx, name);
  }

  function useFormStatus(): FormState {
    const ctx = useContext(HandleCtx);
    return useFormState(ctx);
  }

  function FormProvider({ engine, children }: FormProviderProps<E>): ReactNode {
    const handle = useFormEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { FormProvider, useForm, useField, useFormStatus };
}
