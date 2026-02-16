import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStateMatch } from '../useStateMatch';
import { createNotifier } from '../useWasmState';
import type { IStateMachineEngine } from '../../core/interfaces';
import type { StateMachineHandle } from '../useStateMachineEngine';
import type { StateMachineState } from '../../core/types';

function createMockStateMachineEngine(): IStateMachineEngine {
  let version = 0;
  const states = new Map<string, { label: string }>();
  const transitions: Array<{ from: string; event: string; to: string }> = [];
  let currentState = '';
  let previousState = '';
  const activeStates: string[] = [];

  return {
    add_state(id: string, json: string) { const p = JSON.parse(json); states.set(id, { label: p.label ?? '' }); version++; },
    add_transition(from: string, event: string, to: string) { transitions.push({ from, event, to }); version++; },
    set_initial_state(id: string) { currentState = id; activeStates.length = 0; activeStates.push(id); version++; },
    set_guard() { version++; },
    current_state() { return currentState; },
    current_state_label() { return states.get(currentState)?.label ?? ''; },
    current_state_meta() { return ''; },
    send_event(event: string) {
      const t = transitions.find(tr => tr.from === currentState && tr.event === event);
      if (!t) return false;
      previousState = currentState;
      currentState = t.to;
      activeStates.length = 0;
      activeStates.push(t.to);
      version++;
      return true;
    },
    can_send(event: string) { return transitions.some(t => t.from === currentState && t.event === event); },
    available_event_count() { return transitions.filter(t => t.from === currentState).length; },
    available_event() { return ''; },
    pending_guard() { return ''; },
    resolve_guard() { version++; },
    guard_id() { return ''; },
    previous_state() { return previousState; },
    transition_count() { return 0; },
    state_history_count() { return 0; },
    state_history() { return ''; },
    set_context() { version++; },
    context_json() { return '{}'; },
    merge_context() { version++; },
    active_state_count() { return activeStates.length; },
    active_state(index: number) { return activeStates[index] ?? ''; },
    is_in_state(id: string) { return activeStates.includes(id); },
    on_enter_action() { return ''; },
    on_exit_action() { return ''; },
    data_version() { return version; },
    reset() { currentState = ''; previousState = ''; activeStates.length = 0; states.clear(); transitions.length = 0; version++; },
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

describe('useStateMatch', () => {
  it('returns empty StateMatch when handle is null', () => {
    const { result } = renderHook(() => useStateMatch(null, 'idle'));
    expect(result.current).toEqual({ stateId: '', isActive: false, label: '' });
  });

  it('returns correct match for active state', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMatch(handle, 'idle'));
    expect(result.current).toEqual({ stateId: 'idle', isActive: true, label: 'Idle' });
  });

  it('returns false for non-active state', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMatch(handle, 'running'));
    expect(result.current.isActive).toBe(false);
    expect(result.current.label).toBe('');
  });

  it('updates on state transition', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMatch(handle, 'running'));
    expect(result.current.isActive).toBe(false);
    act(() => { handle.sendEvent('START'); });
    expect(result.current.isActive).toBe(true);
    expect(result.current.label).toBe('Running');
  });

  it('label clears when state is no longer current', () => {
    const engine = createMockStateMachineEngine();
    const handle = createHandle(engine);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    const { result } = renderHook(() => useStateMatch(handle, 'idle'));
    expect(result.current.isActive).toBe(true);
    expect(result.current.label).toBe('Idle');
    act(() => { handle.sendEvent('START'); });
    expect(result.current.isActive).toBe(false);
    expect(result.current.label).toBe('');
  });
});
