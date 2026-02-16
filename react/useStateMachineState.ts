/**
 * useStateMachineState — State machine-level state subscription.
 *
 * For dashboards, state indicators, and transition controls.
 * Re-renders only when state machine-level state changes.
 *
 * Usage:
 *   const { currentState, pendingGuard, transitionCount } = useStateMachineState(handle);
 *   <span>Current: {currentState}</span>
 */

import { useWasmSelector } from './useWasmSelector';
import type { StateMachineHandle } from './useStateMachineEngine';
import type { StateMachineState } from '../core/types';

const EMPTY_STATE: StateMachineState = {
  currentState: '',
  currentStateLabel: '',
  previousState: '',
  pendingGuard: '',
  guardId: '',
  transitionCount: 0,
  availableEventCount: 0,
  activeStateCount: 0,
  contextJson: '',
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useStateMachineState(
  handle: StateMachineHandle | null,
): StateMachineState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        currentState: engine.current_state(),
        currentStateLabel: engine.current_state_label(),
        previousState: engine.previous_state(),
        pendingGuard: engine.pending_guard(),
        guardId: engine.guard_id(),
        transitionCount: engine.transition_count(),
        availableEventCount: engine.available_event_count(),
        activeStateCount: engine.active_state_count(),
        contextJson: engine.context_json(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
