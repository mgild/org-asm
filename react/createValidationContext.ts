/**
 * createValidationContext — Context factory for sharing a ValidationHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createSearchContext pattern: create once per validation engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { ValidationProvider, useValidation, useValidationStatus, useFieldValidation } = createValidationContext<MyValidationEngine>();
 *
 *   // App.tsx
 *   <ValidationProvider engine={engine}>
 *     <MyFormUI />
 *   </ValidationProvider>
 *
 *   // Any descendant
 *   const { addRule, addSchema, validateJson } = useValidation();
 *   const { ruleCount, schemaCount } = useValidationStatus();
 *   const { hasError, firstError } = useFieldValidation('user', 'email');
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useValidationEngine } from './useValidationEngine';
import { useFieldValidation as useFieldValidationHook } from './useFieldValidation';
import { useValidationState } from './useValidationState';
import type { ValidationHandle } from './useValidationEngine';
import type { IValidationEngine } from '../core/interfaces';
import type { FieldValidation, ValidationState } from '../core/types';

export interface ValidationProviderProps<E extends IValidationEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface ValidationContextValue<E extends IValidationEngine> {
  ValidationProvider: (props: ValidationProviderProps<E>) => ReactNode;
  useValidation: () => ValidationHandle<E>;
  useValidationStatus: () => ValidationState;
  useFieldValidation: (schemaId: string, field: string) => FieldValidation;
}

export function createValidationContext<E extends IValidationEngine>(): ValidationContextValue<E> {
  const HandleCtx = createContext<ValidationHandle<E> | null>(null);

  function useValidation(): ValidationHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useValidation must be used within a ValidationProvider');
    }
    return ctx;
  }

  function useValidationStatus(): ValidationState {
    const ctx = useContext(HandleCtx);
    return useValidationState(ctx);
  }

  function useFieldValidation(schemaId: string, field: string): FieldValidation {
    const ctx = useContext(HandleCtx);
    return useFieldValidationHook(ctx, schemaId, field);
  }

  function ValidationProvider({ engine, children }: ValidationProviderProps<E>): ReactNode {
    const handle = useValidationEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { ValidationProvider, useValidation, useValidationStatus, useFieldValidation };
}
