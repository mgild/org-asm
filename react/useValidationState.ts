/**
 * useValidationState — Top-level validation state subscription.
 *
 * For validation status indicators, rule/schema counts, and pending async tracking.
 * Re-renders only when validation-level state (ruleCount, schemaCount, etc.) changes.
 *
 * Usage:
 *   const { ruleCount, schemaCount, pendingValidationCount } = useValidationState(handle);
 *   <span>{schemaCount} schemas, {pendingValidationCount} pending</span>
 */

import { useWasmSelector } from './useWasmSelector';
import type { ValidationHandle } from './useValidationEngine';
import type { ValidationState } from '../core/types';

const EMPTY_STATE: ValidationState = {
  ruleCount: 0,
  schemaCount: 0,
  pendingValidationCount: 0,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useValidationState(
  handle: ValidationHandle | null,
): ValidationState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        ruleCount: engine.rule_count(),
        schemaCount: engine.schema_count(),
        pendingValidationCount: engine.pending_validation_count(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
