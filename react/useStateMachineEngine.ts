/**
 * useStateMachineEngine — Creates a StateMachineHandle wrapping a Rust IStateMachineEngine.
 *
 * The handle provides dispatch functions (addState, sendEvent, resolveGuard, etc.)
 * that mutate the engine and notify subscribers. State-level and per-match
 * hooks subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyStateMachineEngine(), []);
 *   const handle = useStateMachineEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.sendEvent('START');
 *   handle.resolveGuard(true);
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IStateMachineEngine } from '../core/interfaces';
import type { StateMachineState } from '../core/types';

export interface StateMachineHandle<E extends IStateMachineEngine = IStateMachineEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  // Dispatch (mutate + notify)
  addState(id: string, json: string): void;
  addTransition(fromState: string, event: string, toState: string): void;
  setInitialState(id: string): void;
  setGuard(fromState: string, event: string, guardId: string): void;
  sendEvent(event: string): boolean;
  resolveGuard(allowed: boolean): void;
  setContext(json: string): void;
  mergeContext(json: string): void;
  reset(): void;
  // Reads (no notify)
  getStateMachineState(): StateMachineState;
  canSend(event: string): boolean;
  getAvailableEvent(index: number): string;
  getOnEnterAction(stateId: string): string;
  getOnExitAction(stateId: string): string;
  isInState(stateId: string): boolean;
  contextJson(): string;
  stateHistory(index: number): string;
}

export function useStateMachineEngine<E extends IStateMachineEngine>(
  engine: E | null,
): StateMachineHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,
      addState(id: string, json: string): void {
        engine.add_state(id, json);
        notifier.notify();
      },
      addTransition(fromState: string, event: string, toState: string): void {
        engine.add_transition(fromState, event, toState);
        notifier.notify();
      },
      setInitialState(id: string): void {
        engine.set_initial_state(id);
        notifier.notify();
      },
      setGuard(fromState: string, event: string, guardId: string): void {
        engine.set_guard(fromState, event, guardId);
        notifier.notify();
      },
      sendEvent(event: string): boolean {
        const result = engine.send_event(event);
        notifier.notify();
        return result;
      },
      resolveGuard(allowed: boolean): void {
        engine.resolve_guard(allowed);
        notifier.notify();
      },
      setContext(json: string): void {
        engine.set_context(json);
        notifier.notify();
      },
      mergeContext(json: string): void {
        engine.merge_context(json);
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },
      getStateMachineState(): StateMachineState {
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
      canSend(event: string): boolean {
        return engine.can_send(event);
      },
      getAvailableEvent(index: number): string {
        return engine.available_event(index);
      },
      getOnEnterAction(stateId: string): string {
        return engine.on_enter_action(stateId);
      },
      getOnExitAction(stateId: string): string {
        return engine.on_exit_action(stateId);
      },
      isInState(stateId: string): boolean {
        return engine.is_in_state(stateId);
      },
      contextJson(): string {
        return engine.context_json();
      },
      stateHistory(index: number): string {
        return engine.state_history(index);
      },
    };
  }, [engine, notifier]);
}
