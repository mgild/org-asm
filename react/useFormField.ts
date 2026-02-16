/**
 * useFormField — Per-field subscription via useWasmSelector.
 *
 * Only this field's component re-renders when its state changes.
 * Other fields remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { value, error, showError } = useFormField(handle, 'email');
 *   <input value={value} onChange={e => handle.setField('email', e.target.value)} />
 *   {showError && <span>{error}</span>}
 */

import { useWasmSelector } from './useWasmSelector';
import type { FormHandle } from './useFormEngine';
import type { FieldState } from '../core/types';

const EMPTY_FIELD: FieldState = {
  value: '',
  error: '',
  touched: false,
  dirty: false,
  showError: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useFormField(
  handle: FormHandle | null,
  name: string,
): FieldState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_FIELD;
      const { engine } = handle;
      const value = engine.field_value(name);
      const error = engine.field_error(name);
      const touched = engine.field_touched(name);
      const dirty = engine.field_dirty(name);
      const submitted = engine.has_been_submitted();
      const showError = (touched || submitted) && error !== '';
      return { value, error, touched, dirty, showError };
    },
  );
}
