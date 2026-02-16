import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStateMachineEngine } from '../useStateMachineEngine';
import type { IStateMachineEngine } from '../../core/interfaces';

interface StateConfig {
  label: string;
  meta: string;
  onEnter: string;
  onExit: string;
}

interface Transition {
  from: string;
  event: string;
  to: string;
}

function createMockStateMachineEngine(): IStateMachineEngine {
  let version = 0;
  const states = new Map<string, StateConfig>();
  const transitions: Transition[] = [];
  const guards = new Map<string, string>(); // "from:event" -> guardId
  let currentState = '';
  let previousState = '';
  const activeStates: string[] = [];
  const history: string[] = [];
  let context = '{}';
  let pendingGuardId = '';
  let pendingTransitionTo = '';

  function findTransition(from: string, event: string): Transition | undefined {
    return transitions.find(t => t.from === from && t.event === event);
  }

  function getAvailableEvents(): string[] {
    return transitions.filter(t => t.from === currentState).map(t => t.event);
  }

  return {
    // Config
    add_state(id: string, json: string) {
      const parsed = JSON.parse(json);
      states.set(id, {
        label: parsed.label ?? '',
        meta: json,
        onEnter: parsed.onEnter ?? '',
        onExit: parsed.onExit ?? '',
      });
      version++;
    },
    add_transition(fromState: string, event: string, toState: string) {
      transitions.push({ from: fromState, event, to: toState });
      version++;
    },
    set_initial_state(id: string) {
      currentState = id;
      activeStates.length = 0;
      activeStates.push(id);
      history.push(id);
      version++;
    },
    set_guard(fromState: string, event: string, guardId: string) {
      guards.set(`${fromState}:${event}`, guardId);
      version++;
    },

    // State
    current_state() { return currentState; },
    current_state_label() { return states.get(currentState)?.label ?? ''; },
    current_state_meta() { return states.get(currentState)?.meta ?? ''; },

    // Transitions
    send_event(event: string): boolean {
      const t = findTransition(currentState, event);
      if (!t) return false;
      const guardKey = `${currentState}:${event}`;
      const guardId = guards.get(guardKey);
      if (guardId) {
        pendingGuardId = guardId;
        pendingTransitionTo = t.to;
        version++;
        return true;
      }
      previousState = currentState;
      currentState = t.to;
      activeStates.length = 0;
      activeStates.push(t.to);
      history.push(t.to);
      version++;
      return true;
    },
    can_send(event: string) { return findTransition(currentState, event) !== undefined; },
    available_event_count() { return getAvailableEvents().length; },
    available_event(index: number) { return getAvailableEvents()[index] ?? ''; },

    // Guards
    pending_guard() { return pendingGuardId; },
    resolve_guard(allowed: boolean) {
      if (pendingGuardId) {
        if (allowed && pendingTransitionTo) {
          previousState = currentState;
          currentState = pendingTransitionTo;
          activeStates.length = 0;
          activeStates.push(pendingTransitionTo);
          history.push(pendingTransitionTo);
        }
        pendingGuardId = '';
        pendingTransitionTo = '';
        version++;
      }
    },
    guard_id() { return pendingGuardId; },

    // History
    previous_state() { return previousState; },
    transition_count() { return history.length > 0 ? history.length - 1 : 0; },
    state_history_count() { return history.length; },
    state_history(index: number) { return history[index] ?? ''; },

    // Context
    set_context(json: string) { context = json; version++; },
    context_json() { return context; },
    merge_context(json: string) {
      const existing = JSON.parse(context);
      const incoming = JSON.parse(json);
      context = JSON.stringify({ ...existing, ...incoming });
      version++;
    },

    // Parallel
    active_state_count() { return activeStates.length; },
    active_state(index: number) { return activeStates[index] ?? ''; },
    is_in_state(id: string) { return activeStates.includes(id); },

    // Actions
    on_enter_action(stateId: string) { return states.get(stateId)?.onEnter ?? ''; },
    on_exit_action(stateId: string) { return states.get(stateId)?.onExit ?? ''; },

    // Standard
    data_version() { return version; },
    reset() {
      states.clear();
      transitions.length = 0;
      guards.clear();
      currentState = '';
      previousState = '';
      activeStates.length = 0;
      history.length = 0;
      context = '{}';
      pendingGuardId = '';
      pendingTransitionTo = '';
      version++;
    },
  };
}

describe('useStateMachineEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useStateMachineEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns StateMachineHandle with all methods', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.addState).toBe('function');
    expect(typeof handle.addTransition).toBe('function');
    expect(typeof handle.setInitialState).toBe('function');
    expect(typeof handle.setGuard).toBe('function');
    expect(typeof handle.sendEvent).toBe('function');
    expect(typeof handle.resolveGuard).toBe('function');
    expect(typeof handle.setContext).toBe('function');
    expect(typeof handle.mergeContext).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getStateMachineState).toBe('function');
    expect(typeof handle.canSend).toBe('function');
    expect(typeof handle.getAvailableEvent).toBe('function');
    expect(typeof handle.getOnEnterAction).toBe('function');
    expect(typeof handle.getOnExitAction).toBe('function');
    expect(typeof handle.isInState).toBe('function');
    expect(typeof handle.contextJson).toBe('function');
    expect(typeof handle.stateHistory).toBe('function');
  });

  it('addState calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.addState('idle', '{"label":"Idle"}'); });
    expect(engine.current_state_meta).toBeDefined();
    expect(spy).toHaveBeenCalled();
  });

  it('addTransition calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
    });
    expect(spy).toHaveBeenCalled();
  });

  it('setInitialState calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.setInitialState('idle');
    });
    expect(engine.current_state()).toBe('idle');
    expect(spy).toHaveBeenCalled();
  });

  it('setGuard calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setGuard('idle', 'START', 'check_auth'); });
    expect(spy).toHaveBeenCalled();
  });

  it('sendEvent returns boolean and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    let sent = false;
    act(() => { sent = handle.sendEvent('START'); });
    expect(sent).toBe(true);
    expect(engine.current_state()).toBe('running');
    expect(spy).toHaveBeenCalled();
  });

  it('sendEvent returns false for unknown event', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.setInitialState('idle');
    });
    let sent = false;
    act(() => { sent = handle.sendEvent('UNKNOWN'); });
    expect(sent).toBe(false);
  });

  it('guard: sendEvent sets pending, resolveGuard completes transition', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setGuard('idle', 'START', 'check_auth');
      handle.setInitialState('idle');
    });
    let sent = false;
    act(() => { sent = handle.sendEvent('START'); });
    expect(sent).toBe(true);
    expect(engine.current_state()).toBe('idle');
    expect(engine.pending_guard()).toBe('check_auth');
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.resolveGuard(true); });
    expect(engine.current_state()).toBe('running');
    expect(engine.pending_guard()).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('guard: resolveGuard(false) cancels transition', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setGuard('idle', 'START', 'check_auth');
      handle.setInitialState('idle');
    });
    act(() => { handle.sendEvent('START'); });
    act(() => { handle.resolveGuard(false); });
    expect(engine.current_state()).toBe('idle');
    expect(engine.pending_guard()).toBe('');
  });

  it('setContext calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setContext('{"count":1}'); });
    expect(engine.context_json()).toBe('{"count":1}');
    expect(spy).toHaveBeenCalled();
  });

  it('mergeContext calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => { handle.setContext('{"a":1}'); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.mergeContext('{"b":2}'); });
    expect(JSON.parse(engine.context_json())).toEqual({ a: 1, b: 2 });
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine and notifies', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.setInitialState('idle');
    });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.reset(); });
    expect(engine.current_state()).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('getStateMachineState reads all properties', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    const state = handle.getStateMachineState();
    expect(state.currentState).toBe('idle');
    expect(state.currentStateLabel).toBe('Idle');
    expect(state.previousState).toBe('');
    expect(state.pendingGuard).toBe('');
    expect(state.guardId).toBe('');
    expect(state.transitionCount).toBe(0);
    expect(state.availableEventCount).toBe(1);
    expect(state.activeStateCount).toBe(1);
    expect(state.contextJson).toBe('{}');
    expect(typeof state.dataVersion).toBe('number');
  });

  it('canSend reads from engine', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    expect(handle.canSend('START')).toBe(true);
    expect(handle.canSend('STOP')).toBe(false);
  });

  it('getAvailableEvent reads from engine', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    expect(handle.getAvailableEvent(0)).toBe('START');
    expect(handle.getAvailableEvent(1)).toBe('');
  });

  it('getOnEnterAction and getOnExitAction read from engine', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle","onEnter":"logEntry","onExit":"logExit"}');
    });
    expect(handle.getOnEnterAction('idle')).toBe('logEntry');
    expect(handle.getOnExitAction('idle')).toBe('logExit');
  });

  it('isInState reads from engine', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.setInitialState('idle');
    });
    expect(handle.isInState('idle')).toBe(true);
    expect(handle.isInState('running')).toBe(false);
  });

  it('contextJson reads from engine', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => { handle.setContext('{"x":42}'); });
    expect(handle.contextJson()).toBe('{"x":42}');
  });

  it('stateHistory reads from engine', () => {
    const engine = createMockStateMachineEngine();
    const { result } = renderHook(() => useStateMachineEngine(engine));
    const handle = result.current!;
    act(() => {
      handle.addState('idle', '{"label":"Idle"}');
      handle.addState('running', '{"label":"Running"}');
      handle.addTransition('idle', 'START', 'running');
      handle.setInitialState('idle');
    });
    act(() => { handle.sendEvent('START'); });
    expect(handle.stateHistory(0)).toBe('idle');
    expect(handle.stateHistory(1)).toBe('running');
  });
});
