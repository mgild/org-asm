import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createStateMachineContext } from '../createStateMachineContext';
import type { IStateMachineEngine } from '../../core/interfaces';

function createMockStateMachineEngine(): IStateMachineEngine {
  let version = 0;
  const states = new Map<string, { label: string }>();
  const transitions: Array<{ from: string; event: string; to: string }> = [];
  let currentState = '';
  let previousState = '';
  const activeStates: string[] = [];
  const history: string[] = [];
  let context = '{}';

  return {
    add_state(id: string, json: string) { const p = JSON.parse(json); states.set(id, { label: p.label ?? '' }); version++; },
    add_transition(from: string, event: string, to: string) { transitions.push({ from, event, to }); version++; },
    set_initial_state(id: string) { currentState = id; activeStates.length = 0; activeStates.push(id); history.push(id); version++; },
    set_guard() { version++; },
    current_state() { return currentState; },
    current_state_label() { return states.get(currentState)?.label ?? ''; },
    current_state_meta() { return states.get(currentState)?.label ?? ''; },
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

describe('createStateMachineContext', () => {
  it('useStateMachine returns handle from provider', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const engine = createMockStateMachineEngine();
    engine.add_state('idle', '{"label":"Idle"}');
    engine.set_initial_state('idle');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.StateMachineProvider engine={engine}>{children}</ctx.StateMachineProvider>
    );
    const { result } = renderHook(() => ctx.useStateMachine(), { wrapper });
    expect(result.current.engine).toBe(engine);
    expect(typeof result.current.sendEvent).toBe('function');
    expect(typeof result.current.resolveGuard).toBe('function');
  });

  it('useStateMachineStatus returns state from provider', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const engine = createMockStateMachineEngine();
    engine.add_state('idle', '{"label":"Idle"}');
    engine.set_initial_state('idle');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.StateMachineProvider engine={engine}>{children}</ctx.StateMachineProvider>
    );
    const { result } = renderHook(() => ctx.useStateMachineStatus(), { wrapper });
    expect(result.current.currentState).toBe('idle');
    expect(result.current.currentStateLabel).toBe('Idle');
  });

  it('useStateMatch returns match state from provider', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const engine = createMockStateMachineEngine();
    engine.add_state('idle', '{"label":"Idle"}');
    engine.set_initial_state('idle');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.StateMachineProvider engine={engine}>{children}</ctx.StateMachineProvider>
    );
    const { result } = renderHook(() => ctx.useStateMatch('idle'), { wrapper });
    expect(result.current).toEqual({ stateId: 'idle', isActive: true, label: 'Idle' });
  });

  it('useStateMachine throws outside provider', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    expect(() => { renderHook(() => ctx.useStateMachine()); }).toThrow('useStateMachine must be used within a StateMachineProvider');
  });

  it('useStateMachineStatus returns empty state outside provider', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const { result } = renderHook(() => ctx.useStateMachineStatus());
    expect(result.current.currentState).toBe('');
  });

  it('useStateMatch returns empty state outside provider', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const { result } = renderHook(() => ctx.useStateMatch('idle'));
    expect(result.current).toEqual({ stateId: '', isActive: false, label: '' });
  });

  it('children render correctly', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const engine = createMockStateMachineEngine();
    const { container } = render(
      <ctx.StateMachineProvider engine={engine}><div data-testid="child">Hello</div></ctx.StateMachineProvider>,
    );
    expect(container.textContent).toBe('Hello');
  });

  it('StateMachineProvider works with null engine', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const { result } = renderHook(() => ctx.useStateMachineStatus(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.StateMachineProvider engine={null}>{children}</ctx.StateMachineProvider>
      ),
    });
    expect(result.current.currentState).toBe('');
  });

  it('mutations via useStateMachine propagate to useStateMachineStatus and useStateMatch', () => {
    const ctx = createStateMachineContext<IStateMachineEngine>();
    const engine = createMockStateMachineEngine();
    engine.add_state('idle', '{"label":"Idle"}');
    engine.add_state('running', '{"label":"Running"}');
    engine.add_transition('idle', 'START', 'running');
    engine.set_initial_state('idle');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.StateMachineProvider engine={engine}>{children}</ctx.StateMachineProvider>
    );
    const { result } = renderHook(
      () => ({
        sm: ctx.useStateMachine(),
        status: ctx.useStateMachineStatus(),
        match: ctx.useStateMatch('running'),
      }),
      { wrapper },
    );
    expect(result.current.match.isActive).toBe(false);
    act(() => { result.current.sm.sendEvent('START'); });
    expect(result.current.status.currentState).toBe('running');
    expect(result.current.match.isActive).toBe(true);
  });
});
