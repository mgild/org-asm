/**
 * useFormState — Top-level form state subscription.
 *
 * For submit buttons, form-level indicators, and progress tracking.
 * Re-renders only when form-level state (isValid, isDirty, etc.) changes.
 *
 * Usage:
 *   const { isValid, canSubmit, isDirty } = useFormState(handle);
 *   <button disabled={!canSubmit}>Submit</button>
 */

import { useWasmSelector } from './useWasmSelector';
import type { FormHandle } from './useFormEngine';
import type { FormState } from '../core/types';

const EMPTY_STATE: FormState = {
  isValid: false,
  isDirty: false,
  canSubmit: false,
  hasBeenSubmitted: false,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useFormState(
  handle: FormHandle | null,
): FormState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        isValid: engine.is_valid(),
        isDirty: engine.is_dirty(),
        canSubmit: engine.can_submit(),
        hasBeenSubmitted: engine.has_been_submitted(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
