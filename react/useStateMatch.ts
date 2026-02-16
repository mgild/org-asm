/**
 * useStateMatch — Per-state match subscription via useWasmSelector.
 *
 * Only this state's component re-renders when its match state changes.
 *
 * Usage:
 *   const { isActive, label } = useStateMatch(handle, 'loading');
 *   {isActive && <LoadingSpinner label={label} />}
 */

import { useWasmSelector } from './useWasmSelector';
import type { StateMachineHandle } from './useStateMachineEngine';
import type { StateMatch } from '../core/types';

const EMPTY_MATCH: StateMatch = {
  stateId: '',
  isActive: false,
  label: '',
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useStateMatch(
  handle: StateMachineHandle | null,
  stateId: string,
): StateMatch {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_MATCH;
      return {
        stateId,
        isActive: handle.engine.is_in_state(stateId),
        label: stateId === handle.engine.current_state()
          ? handle.engine.current_state_label()
          : '',
      };
    },
  );
}
