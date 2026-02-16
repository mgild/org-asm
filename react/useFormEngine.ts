/**
 * useFormEngine — Creates a FormHandle wrapping a Rust IFormEngine.
 *
 * The handle provides dispatch functions (setField, touchField, submit, reset)
 * that mutate the engine and notify subscribers. Per-field and form-level hooks
 * (useFormField, useFormState) subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyFormEngine(), []);
 *   const handle = useFormEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.setField('email', value);
 *   const valid = handle.submit();
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IFormEngine } from '../core/interfaces';
import type { FormState } from '../core/types';

export interface FormHandle<E extends IFormEngine = IFormEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  setField(name: string, value: string): void;
  touchField(name: string): void;
  submit(): boolean;
  reset(): void;
  getFieldValue(name: string): string;
  getFormState(): FormState;
}

export function useFormEngine<E extends IFormEngine>(
  engine: E | null,
): FormHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

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
  }, [engine, notifier]);
}
