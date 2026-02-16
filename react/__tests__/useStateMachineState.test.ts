import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStateMachineState } from '../useStateMachineState';
import { createNotifier } from '../useWasmState';
import type { IStateMachineEngine } from '../../core/interfaces';
import type { StateMachineHandle } from '../useStateMachineEngine';
import type { StateMachineState } from '../../core/types';

function createMockStateMachineEngine(): IStateMachineEngine {
  let version = 0;
  const states = new Map<string, { label: string; meta: string }>();
  const transitions: Array<{ from: string; event: string; to: string }> = [];
  let currentState = '';
  let previousState = '';
  const activeStates: string[] = [];
  const history: string[] = [];
  let context = '{}';

  return {
    add_state(id: string, json: string) { const p = JSON.parse(json); states.set(id, { label: p.label ?? '', meta: json }); version++; },
    add_transition(from: string, event: string, to: string) { transitions.push({ from, event, to }); version++; },
    set_initial_state(id: string) { currentState = id; activeStates.length = 0; activeStates.push(id); history.push(id); version++; },
    set_guard() { version++; },
    current_state() { return currentState; },
    current_state_label() { return states.get(currentState)?.label ?? ''; },
    current_state_meta() { return states.get(currentState)?.meta ?? ''; },
    send_event(event: string) {
      const t = transitions.find(tr => tr.from === currentState && tr.event === event);
      if (!t) return false;
      previousState = currentState;
      currentState = t.to;
      activeStates.length = 0;
      activeStates.push(t.to);
      history.push(t.to);
      version++;
      return true;
    },
    can_send(event: string) { return transitions.some(t => t.from === currentState && t.event === event); },
    available_event_count() { return transitions.filter(t => t.from === currentState).length; },
    available_event(index: number) { return transitions.filter(t => t.from === currentState)[index]?.event ?? ''; },
    pending_guard() { return ''; },
    resolve_guard() { version++; },
    guard_id() { return ''; },
    previous_state() { return previousState; },
    transition_count() { return history.length > 0 ? history.length - 1 : 0; },
    state_history_count() { return history.length; },
    state_history(index: number) { return history[index] ?? ''; },
    set_context(json: string) { context = json; version++; },
    context_json() { return context; },
    merge_context(json: string) { const e = JSON.parse(context); const i = JSON.parse(json); context = JSON.stringify({ ...e, ...i }); version++; },
    active_state_count() { return activeStates.length; },
    active_state(index: number) { return activeStates[index] ?? ''; },
    is_in_state(id: string) { return activeStates.includes(id); },
    on_enter_action() { return ''; },
    on_exit_action() { return ''; },
    data_version() { return version; },
    reset() { states.clear(); transitions.length = 0; currentState = ''; previousState = ''; activeStates.length = 0; history.length = 0; context = '{}'; version++; },
  };
}

function createHandle(engine: IStateMachineEngine): StateMachineHandle {
  const notifier = createNotifier();
  return {
    engine, notifier,
    addState(id: string, json: string) { engine.add_state(id, json); notifier.notify(); },
    addTransition(from: string, event: string, to: string) { engine.add_transition(from, event, to); notifier.notify(); },
    setInitialState(id: string) { engine.set_initial_state(id); notifier.notify(); },
    setGuard(from: string, event: string, guardId: string) { engine.set_guard(from, event, guardId); notifier.notify(); },
    sendEvent(event: string) { const r = engine.send_event(event); notifier.notify(); return r; },
    resolveGuard(allowed: boolean) { engine.resolve_guard(allowed); notifier.notify(); },
    setContext(json: string) { engine.set_context(json); notifier.notify(); },
    mergeContext(json: string) { engine.merge_context(json); notifier.notify(); },
    reset() { engine.reset(); notifier.notify(); },
    getStateMachineState(): StateMachineState { return { currentState: engine.current_state(), currentStateLabel: engine.current_state_label(), previousState: engine.previous_state(), pendingGuard: engine.pending_guard(), guardId: engine.guard_id(), transitionCount: engine.transition_count(), availableEventCount: engine.available_event_count(), activeStateCount: engine.active_state_count(), contextJson: engine.context_json(), dataVersion: engine.data_version() }; },
    canSend(event: string) { return engine.can_send(event); },
    getAvailableEvent(index: number) { return engine.available_event(index); },
    getOnEnterAction(stateId: string) { return engine.on_enter_action(stateId); },
    getOnExitAction(stateId: string) { return engine.on_exit_action(stateId); },
    isInState(stateId: string) { return engine.is_in_state(stateId); },
    contextJson() { return engine.context_json(); },
    stateHistory(index: number) { return engine.state_history(index); },
  };
}

describe('useStateMachineState', () => {
  it('returns empty StateMachineState when handle is null', () => {
    const { result } = renderHook(() => useStateMachineState(null));
    expect(result.current).toEqual({
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
    });
  });

  it('returns correct state machine state', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMachineState(handle));
    expect(result.current.currentState).toBe('idle');
    expect(result.current.currentStateLabel).toBe('Idle');
    expect(result.current.availableEventCount).toBe(1);
    expect(result.current.activeStateCount).toBe(1);
  });

  it('reflects state change after sendEvent', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMachineState(handle));
    expect(result.current.currentState).toBe('idle');
    act(() => { handle.sendEvent('START'); });
    expect(result.current.currentState).toBe('running');
    expect(result.current.currentStateLabel).toBe('Running');
    expect(result.current.previousState).toBe('idle');
    expect(result.current.transitionCount).toBe(1);
  });

  it('reflects context change', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useStateMachineState(handle));
    expect(result.current.contextJson).toBe('{}');
    act(() => { handle.setContext('{"count":5}'); });
    expect(result.current.contextJson).toBe('{"count":5}');
  });

  it('updates on reset', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMachineState(handle));
    expect(result.current.currentState).toBe('idle');
    act(() => { handle.reset(); });
    expect(result.current.currentState).toBe('');
  });
});
