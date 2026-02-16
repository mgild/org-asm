/**
 * useFieldValidation — Per-field validation subscription via useWasmSelector.
 *
 * Only this field's component re-renders when its validation state changes.
 * Other fields remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { hasError, firstError, errorCount } = useFieldValidation(handle, 'user', 'email');
 *   {hasError && <span>{firstError}</span>}
 */

import { useWasmSelector } from './useWasmSelector';
import type { ValidationHandle } from './useValidationEngine';
import type { FieldValidation } from '../core/types';

const EMPTY_FIELD: FieldValidation = {
  schemaId: '',
  field: '',
  errorCount: 0,
  hasError: false,
  firstError: '',
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useFieldValidation(
  handle: ValidationHandle | null,
  schemaId: string,
  field: string,
): FieldValidation {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_FIELD;
      const { engine } = handle;
      return {
        schemaId,
        field,
        errorCount: engine.field_error_count(schemaId, field),
        hasError: engine.field_has_error(schemaId, field),
        firstError: engine.field_error(schemaId, field, 0),
      };
    },
  );
}
